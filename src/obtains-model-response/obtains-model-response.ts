import type {
  AttemptTestimony,
  ModelConnectorDependencies,
  ModelExecutionDisposition,
  ModelInvocationContext,
  ModelRequest,
  ModelResponse,
  ProviderInvocationTestimony,
} from "../shared/model-connector-contract.js";
import {
  classifiesModelInvocationFailure,
  isTransientProviderFailure,
} from "./classifies-model-invocation-failure.js";
import { invokesProviderAdapter } from "./invokes-provider-adapter.js";
import { normalizesModelResponse } from "./normalizes-model-response.js";
import { preparesModelInvocationContext } from "./prepares-model-invocation-context.js";
import { recordsProviderTestimony } from "./records-provider-testimony.js";
import { resolvesModelAlias } from "./resolves-model-alias.js";
import { resolvesProviderAuthority } from "./resolves-provider-authority.js";
import {
  returnsModelExecutionReceipt,
  returnsPreInvocationReceipt,
  type ExecutionWindow,
} from "./returns-model-execution-receipt.js";
import {
  asValidatedModelRequest,
  validatesModelRequest,
} from "./validates-model-request.js";

/**
 * Obtain one normalized model response under an explicitly resolved provider,
 * model, request, execution policy, and evidence policy.
 *
 * No provider SDK object crosses this body. No prompt decision is made here.
 * No fallback is embedded here.
 */
export async function obtainsModelResponse(
  request: unknown,
  dependencies: ModelConnectorDependencies
): Promise<ModelResponse> {
  const startedAt = dependencies.clock.now().toISOString();
  const startedTick = dependencies.clock.monotonicMilliseconds();

  const closesWindow = (): ExecutionWindow => {
    const completed = dependencies.clock.now().toISOString();

    return {
      startedAt,
      completedAt: completed,
      durationMilliseconds:
        dependencies.clock.monotonicMilliseconds() - startedTick,
    };
  };

  const validation = validatesModelRequest(request);

  if (!validation.accepted) {
    return returnsPreInvocationReceipt(
      readsRequestId(request),
      "MODEL_REQUEST_REJECTED",
      validation.findings,
      undefined,
      closesWindow(),
      undefined
    );
  }

  const validRequest = asValidatedModelRequest(request);

  const providerAuthority = resolvesProviderAuthority(
    validRequest.providerAuthorityId,
    dependencies.providerAuthorities
  );

  if (!providerAuthority.resolved) {
    return returnsPreInvocationReceipt(
      validRequest.requestId,
      "PROVIDER_AUTHORITY_NOT_FOUND",
      [
        {
          code: "PROVIDER_AUTHORITY_NOT_FOUND",
          detail: providerAuthority.detail,
          pointer: "/providerAuthorityId",
        },
      ],
      {
        providerAuthorityId: validRequest.providerAuthorityId,
        modelAlias: validRequest.modelAlias,
      },
      closesWindow(),
      undefined
    );
  }

  const modelAuthority = resolvesModelAlias(
    validRequest.modelAlias,
    validRequest.interaction.mode,
    providerAuthority.authority
  );

  if (!modelAuthority.resolved) {
    const disposition: ModelExecutionDisposition =
      modelAuthority.reason === "alias-not-found"
        ? "MODEL_ALIAS_NOT_FOUND"
        : "INTERACTION_MODE_NOT_SUPPORTED";

    return returnsPreInvocationReceipt(
      validRequest.requestId,
      disposition,
      [
        {
          code: disposition,
          detail: modelAuthority.detail,
          pointer:
            modelAuthority.reason === "alias-not-found"
              ? "/modelAlias"
              : "/interaction/mode",
        },
      ],
      {
        providerAuthorityId: providerAuthority.authority.providerAuthorityId,
        providerKind: providerAuthority.authority.providerKind,
        modelAlias: validRequest.modelAlias,
      },
      closesWindow(),
      undefined
    );
  }

  return runsAuthorizedAttempts(
    validRequest,
    providerAuthority.authority,
    modelAuthority.model,
    dependencies,
    closesWindow
  );
}

/**
 * Consumes authorized attempts one at a time.
 *
 * An attempt is only repeated when the declared continuation rule permits it
 * and the provider reported a transient failure. Substitution is never
 * performed here: a request authorizes exactly one provider.
 */
async function runsAuthorizedAttempts(
  request: ModelRequest,
  providerAuthority: ModelConnectorDependencies["providerAuthorities"][number],
  modelAuthority: Parameters<typeof preparesModelInvocationContext>[2],
  dependencies: ModelConnectorDependencies,
  closesWindow: () => ExecutionWindow
): Promise<ModelResponse> {
  const { maximumAuthorizedAttempts, continuationRule } =
    request.executionPolicy.attemptAuthority;

  const attempts: AttemptTestimony[] = [];

  let lastContext: ModelInvocationContext | undefined;
  let lastTestimony: ProviderInvocationTestimony | undefined;

  for (
    let attemptNumber = 1;
    attemptNumber <= maximumAuthorizedAttempts;
    attemptNumber += 1
  ) {
    const context = preparesModelInvocationContext(
      request,
      providerAuthority,
      modelAuthority,
      attemptNumber,
      dependencies.identity,
      dependencies.hashes
    );

    lastContext = context;

    let testimony: ProviderInvocationTestimony;

    try {
      testimony = await invokesProviderAdapter(
        context,
        dependencies.providerAdapters
      );
    } catch (error) {
      return returnsPreInvocationReceipt(
        request.requestId,
        "INTERNAL_EXECUTION_FAILED",
        [
          {
            code: "INTERNAL_EXECUTION_FAILED",
            detail:
              error instanceof Error ? error.message : "Unknown internal error.",
          },
        ],
        {
          providerAuthorityId: providerAuthority.providerAuthorityId,
          providerKind: providerAuthority.providerKind,
          modelAlias: request.modelAlias,
          resolvedModel: modelAuthority.resolvedModel,
        },
        closesWindow(),
        context.requestHash
      );
    }

    lastTestimony = testimony;
    attempts.push(recordsProviderTestimony(attemptNumber, testimony));

    if (testimony.disposition === "provider-responded") {
      const normalized = normalizesModelResponse(context, testimony);

      return returnsModelExecutionReceipt(
        context,
        testimony,
        normalized,
        attempts,
        normalized.satisfied
          ? "MODEL_RESPONSE_OBTAINED"
          : "RESPONSE_FORMAT_NOT_SATISFIED",
        closesWindow(),
        dependencies.hashes
      );
    }

    const mayContinue =
      continuationRule === "continue-while-provider-reports-transient-failure" &&
      isTransientProviderFailure(testimony.disposition) &&
      attemptNumber < maximumAuthorizedAttempts;

    if (!mayContinue) {
      break;
    }
  }

  // Loop exhausted or halted on a failing attempt.
  const context = lastContext!;
  const testimony = lastTestimony!;

  const exhaustedTransientAuthority =
    attempts.length === maximumAuthorizedAttempts &&
    maximumAuthorizedAttempts > 1 &&
    isTransientProviderFailure(testimony.disposition);

  const disposition: ModelExecutionDisposition = exhaustedTransientAuthority
    ? "ATTEMPT_AUTHORITY_EXHAUSTED"
    : classifiesModelInvocationFailure(testimony.disposition);

  return returnsModelExecutionReceipt(
    context,
    testimony,
    {
      satisfied: false,
      detail:
        testimony.providerFailure?.providerMessage ??
        `The provider reported "${testimony.disposition}".`,
    },
    attempts,
    disposition,
    closesWindow(),
    dependencies.hashes
  );
}

function readsRequestId(request: unknown): string {
  if (
    typeof request === "object" &&
    request !== null &&
    typeof (request as { requestId?: unknown }).requestId === "string"
  ) {
    return (request as { requestId: string }).requestId;
  }

  return "unknown-request";
}
