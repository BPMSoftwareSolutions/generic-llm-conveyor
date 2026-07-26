import type {
  AttemptTestimony,
  EvidencePolicy,
  HashPort,
  ModelExecutionDisposition,
  ModelExecutionReceipt,
  ModelInvocationContext,
  ModelResponse,
  ProviderInvocationTestimony,
  ResolvedAuthorityTestimony,
} from "../shared/model-connector-contract.js";
import type { NormalizedModelResult } from "./normalizes-model-response.js";

export const MODEL_RESPONSE_SCHEMA =
  "./authority/model-response.schema.v1.json";

export type ExecutionWindow = Readonly<{
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
}>;

/**
 * Returns result, observations, hashes, and disposition.
 *
 * Every exit from the capability passes through a receipt producer — there is
 * no path that returns a result without proof.
 */
export function returnsModelExecutionReceipt(
  context: ModelInvocationContext,
  testimony: ProviderInvocationTestimony,
  normalized: NormalizedModelResult,
  attempts: readonly AttemptTestimony[],
  disposition: ModelExecutionDisposition,
  window: ExecutionWindow,
  hashes: HashPort
): ModelResponse {
  const policy = context.evidencePolicy;

  const responseHashSubject = normalized.satisfied
    ? normalized.result
    : testimony.response;

  return Object.freeze({
    $schema: MODEL_RESPONSE_SCHEMA,
    requestId: context.requestId,
    invocationId: context.invocationId,
    disposition,

    resolvedAuthority: buildsResolvedAuthority(context, policy),

    result: normalized.satisfied ? normalized.result : undefined,

    usage:
      policy.captureTokenUsage && testimony.usage
        ? Object.freeze({ ...testimony.usage })
        : undefined,

    findings: normalized.satisfied
      ? undefined
      : Object.freeze([
          Object.freeze({
            code: disposition,
            detail: normalized.detail,
            pointer:
              disposition === "RESPONSE_FORMAT_NOT_SATISFIED"
                ? "/responsePolicy/format"
                : undefined,
          }),
        ]),

    attempts: Object.freeze([...attempts]),

    proof: buildsProof(context, responseHashSubject, attempts, window, hashes),
  });
}

/**
 * Receipt for an execution that never reached the provider boundary, so there
 * is no invocation context to draw on.
 */
export function returnsPreInvocationReceipt(
  requestId: string,
  disposition: ModelExecutionDisposition,
  findings: readonly Readonly<{
    code: string;
    detail: string;
    pointer?: string;
  }>[],
  resolvedAuthority: ResolvedAuthorityTestimony | undefined,
  window: ExecutionWindow,
  requestHash: string | undefined
): ModelResponse {
  return Object.freeze({
    $schema: MODEL_RESPONSE_SCHEMA,
    requestId,
    disposition,
    resolvedAuthority,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    attempts: Object.freeze([]),
    proof: Object.freeze({
      requestHash,
      responseHash: undefined,
      attemptCount: 0,
      startedAt: window.startedAt,
      completedAt: window.completedAt,
      durationMilliseconds: window.durationMilliseconds,
    }),
  });
}

function buildsResolvedAuthority(
  context: ModelInvocationContext,
  policy: EvidencePolicy
): ResolvedAuthorityTestimony {
  return Object.freeze({
    providerAuthorityId: context.provider.authorityId,
    providerKind: policy.captureResolvedProvider
      ? context.provider.kind
      : undefined,
    modelAlias: context.model.alias,
    resolvedModel: policy.captureResolvedModel
      ? context.model.resolvedName
      : undefined,
  });
}

function buildsProof(
  context: ModelInvocationContext,
  responseHashSubject: unknown,
  attempts: readonly AttemptTestimony[],
  window: ExecutionWindow,
  hashes: HashPort
): ModelExecutionReceipt {
  const policy = context.evidencePolicy;

  return Object.freeze({
    requestHash: policy.captureRequestHash ? context.requestHash : undefined,
    responseHash:
      policy.captureResponseHash && responseHashSubject !== undefined
        ? hashes.hashes(responseHashSubject)
        : undefined,
    attemptCount: attempts.length,
    startedAt: policy.captureTiming ? window.startedAt : window.startedAt,
    completedAt: window.completedAt,
    durationMilliseconds: window.durationMilliseconds,
  });
}
