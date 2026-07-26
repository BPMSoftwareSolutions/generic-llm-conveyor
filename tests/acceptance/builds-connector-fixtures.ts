import type {
  ModelConnectorDependencies,
  ModelInvocationContext,
  ModelProviderAdapter,
  ModelRequest,
  ProviderAuthority,
  ProviderDisposition,
  ProviderInvocationTestimony,
  ProviderKind,
} from "../../src/shared/model-connector-contract.js";
import {
  createsFixedClock,
  createsSequentialIdentity,
  sha256Hashes,
} from "../../src/shared/runtime-ports.js";

export const FIXED_INSTANT = "2026-07-26T08:10:00.000Z";

/**
 * A provider adapter that records every context it receives.
 *
 * Invocation counts are the evidence for "exactly once", "not at all", and
 * "exactly twice" — the connector's attempt and substitution guarantees are
 * only observable at this boundary.
 */
export type RecordingAdapter = ModelProviderAdapter & {
  readonly receivedContexts: readonly ModelInvocationContext[];
  readonly invocationCount: number;
};

export type ScriptedOutcome = Readonly<{
  disposition: ProviderDisposition;
  text?: string;
  structuredValue?: unknown;
  finishReason?: string;
  usage?: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;
  providerCode?: string;
  providerMessage?: string;
}>;

export function createsRecordingAdapter(
  adapterId: string,
  providerKind: ProviderKind,
  outcomes: readonly ScriptedOutcome[]
): RecordingAdapter {
  const receivedContexts: ModelInvocationContext[] = [];

  return {
    adapterId,
    providerKind,

    get receivedContexts() {
      return receivedContexts;
    },

    get invocationCount() {
      return receivedContexts.length;
    },

    async invokesProviderModel(
      context: ModelInvocationContext
    ): Promise<ProviderInvocationTestimony> {
      receivedContexts.push(context);

      // The last scripted outcome repeats, so a two-attempt scenario can be
      // described with a single scripted failure.
      const outcome =
        outcomes[Math.min(receivedContexts.length - 1, outcomes.length - 1)]!;

      return Object.freeze({
        invocationId: context.invocationId,
        providerKind,
        resolvedModel: context.model.resolvedName,
        disposition: outcome.disposition,
        response:
          outcome.disposition === "provider-responded"
            ? Object.freeze({
                text: outcome.text,
                structuredValue: outcome.structuredValue,
                finishReason: outcome.finishReason ?? "STOP",
              })
            : undefined,
        usage: outcome.usage,
        observation: Object.freeze({
          startedAt: FIXED_INSTANT,
          completedAt: FIXED_INSTANT,
          durationMilliseconds: 1240,
          providerRequestId: `provider-request-${receivedContexts.length}`,
        }),
        providerFailure:
          outcome.disposition === "provider-responded"
            ? undefined
            : Object.freeze({
                providerCode: outcome.providerCode ?? "PROVIDER_FAILURE",
                providerMessage:
                  outcome.providerMessage ?? "The provider reported a failure.",
              }),
      });
    },
  };
}

export const geminiAuthority: ProviderAuthority = {
  providerAuthorityId: "primary-cognitive-provider",
  providerKind: "gemini",
  adapterId: "invokes-gemini-model",
  credentialReference: { source: "environment" as const, name: "GEMINI_API_KEY" },
  endpointAuthority: { mode: "provider-default" as const },
  modelAliases: {
    "instruction-capable-model": {
      resolvedModel: "gemini-flash-latest",
      supportedInteractionModes: ["text-generation", "structured-generation"],
    },
    "text-only-model": {
      resolvedModel: "gemini-flash-lite-latest",
      supportedInteractionModes: ["text-generation"],
    },
  },
  capabilities: {
    supportsUsageReporting: true,
    supportsStructuredOutput: true,
    supportsStreaming: false,
  },
};

export const openaiAuthority: ProviderAuthority = {
  providerAuthorityId: "secondary-cognitive-provider",
  providerKind: "openai",
  adapterId: "invokes-openai-model",
  credentialReference: { source: "environment" as const, name: "OPENAI_API_KEY" },
  endpointAuthority: { mode: "provider-default" as const },
  modelAliases: {
    "instruction-capable-model": {
      resolvedModel: "gpt-4.1-mini",
      supportedInteractionModes: ["text-generation"],
    },
  },
  capabilities: {
    supportsUsageReporting: true,
    supportsStructuredOutput: true,
    supportsStreaming: false,
  },
};

export function buildsValidRequest(
  overrides: Partial<ModelRequest> = {}
): ModelRequest {
  return Object.freeze({
    requestId: "explain-execution-result-001",
    providerAuthorityId: "primary-cognitive-provider",
    modelAlias: "instruction-capable-model",
    interaction: {
      mode: "text-generation",
      messages: [
        {
          role: "system",
          content:
            "Explain only what is supported by the supplied execution evidence.",
        },
        { role: "user", content: "Explain this execution receipt." },
      ],
    },
    responsePolicy: {
      format: "text",
      maximumOutputTokens: 1200,
      temperature: 0.1,
    },
    executionPolicy: {
      timeoutMilliseconds: 60000,
      attemptAuthority: { maximumAuthorizedAttempts: 1 },
      providerSubstitution: { allowed: false },
    },
    evidencePolicy: {
      captureRequestHash: true,
      captureResponseHash: true,
      captureResolvedProvider: true,
      captureResolvedModel: true,
      captureTokenUsage: true,
      captureTiming: true,
    },
    ...overrides,
  }) as ModelRequest;
}

export function buildsDependencies(
  adapters: readonly ModelProviderAdapter[],
  authorities: readonly ProviderAuthority[] = [geminiAuthority]
): ModelConnectorDependencies {
  return Object.freeze({
    providerAuthorities: authorities,
    providerAdapters: adapters,
    clock: createsFixedClock(FIXED_INSTANT, 1240),
    hashes: sha256Hashes,
    identity: createsSequentialIdentity(),
  });
}
