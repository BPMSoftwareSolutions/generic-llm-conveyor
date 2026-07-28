/**
 * Canonical vocabulary for the generic LLM connector.
 *
 * Nothing in this file may reference a provider SDK, a transport, or a
 * runtime environment. Provider protocol lives behind an adapter.
 */

export type ProviderKind =
  | "gemini"
  | "openai"
  | "anthropic"
  | "litellm"
  | "llamacpp";

export type InteractionMode = "text-generation" | "structured-generation";

export type ResponseFormat = "text" | "json";

export type MessageRole = "system" | "user" | "assistant";

export type ModelMessage = Readonly<{
  role: MessageRole;
  content: string;
}>;

/** The stable disposition vocabulary. Downstream consumers decide on these. */
export const MODEL_EXECUTION_DISPOSITIONS = [
  "MODEL_RESPONSE_OBTAINED",
  "MODEL_REQUEST_REJECTED",
  "PROVIDER_AUTHORITY_NOT_FOUND",
  "MODEL_ALIAS_NOT_FOUND",
  "INTERACTION_MODE_NOT_SUPPORTED",
  "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMED_OUT",
  "PROVIDER_REQUEST_REJECTED",
  "RESPONSE_FORMAT_NOT_SATISFIED",
  "ATTEMPT_AUTHORITY_EXHAUSTED",
  "EXECUTION_CANCELLED",
  "INTERNAL_EXECUTION_FAILED",
] as const;

export type ModelExecutionDisposition =
  (typeof MODEL_EXECUTION_DISPOSITIONS)[number];

/** Exit codes are part of the contract, not a CLI implementation detail. */
export const DISPOSITION_EXIT_CODES: Readonly<
  Record<ModelExecutionDisposition, number>
> = Object.freeze({
  MODEL_RESPONSE_OBTAINED: 0,
  MODEL_REQUEST_REJECTED: 10,
  PROVIDER_AUTHORITY_NOT_FOUND: 11,
  MODEL_ALIAS_NOT_FOUND: 12,
  INTERACTION_MODE_NOT_SUPPORTED: 13,
  PROVIDER_AUTHENTICATION_FAILED: 20,
  PROVIDER_UNAVAILABLE: 21,
  PROVIDER_TIMED_OUT: 22,
  PROVIDER_REQUEST_REJECTED: 23,
  RESPONSE_FORMAT_NOT_SATISFIED: 30,
  ATTEMPT_AUTHORITY_EXHAUSTED: 31,
  EXECUTION_CANCELLED: 40,
  INTERNAL_EXECUTION_FAILED: 50,
});

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

export type EvidencePolicy = Readonly<{
  captureRequestHash: boolean;
  captureResponseHash: boolean;
  captureResolvedProvider: boolean;
  captureResolvedModel: boolean;
  captureTokenUsage: boolean;
  captureTiming: boolean;
}>;

export type AttemptAuthority = Readonly<{
  maximumAuthorizedAttempts: number;
  continuationRule?: "continue-while-provider-reports-transient-failure";
}>;

export type ModelRequest = Readonly<{
  $schema?: string;
  requestId: string;
  providerAuthorityId: string;
  modelAlias: string;

  interaction: Readonly<{
    mode: InteractionMode;
    messages: readonly ModelMessage[];
  }>;

  responsePolicy: Readonly<{
    format: ResponseFormat;
    maximumOutputTokens: number;
    temperature?: number;
    /** Declared shape a "json" response must satisfy. */
    schema?: Readonly<Record<string, unknown>>;
  }>;

  executionPolicy: Readonly<{
    timeoutMilliseconds: number;
    attemptAuthority: AttemptAuthority;
    providerSubstitution: Readonly<{ allowed: boolean }>;
  }>;

  evidencePolicy: EvidencePolicy;
}>;

// ---------------------------------------------------------------------------
// Provider authority contract
// ---------------------------------------------------------------------------

export type ModelAliasAuthority = Readonly<{
  resolvedModel: string;
  supportedInteractionModes: readonly InteractionMode[];
}>;

export type ProviderAuthority = Readonly<{
  $schema?: string;
  providerAuthorityId: string;
  providerKind: ProviderKind;
  adapterId: string;

  credentialReference: Readonly<{
    source: "environment";
    name: string;
  }>;

  endpointAuthority: Readonly<{
    mode: "provider-default" | "explicit";
    endpoint?: string;
  }>;

  modelAliases: Readonly<Record<string, ModelAliasAuthority>>;

  capabilities: Readonly<{
    supportsUsageReporting: boolean;
    supportsStructuredOutput: boolean;
    supportsStreaming: boolean;
  }>;
}>;

// ---------------------------------------------------------------------------
// Immutable invocation context
// ---------------------------------------------------------------------------

export type ModelInvocationContext = Readonly<{
  invocationId: string;
  requestId: string;

  provider: Readonly<{
    authorityId: string;
    kind: ProviderKind;
    adapterId: string;
    endpoint?: string;
    credentialReference: Readonly<{ source: "environment"; name: string }>;
  }>;

  model: Readonly<{
    alias: string;
    resolvedName: string;
  }>;

  interaction: Readonly<{
    mode: InteractionMode;
    messages: readonly ModelMessage[];
  }>;

  responsePolicy: Readonly<{
    format: ResponseFormat;
    maximumOutputTokens: number;
    temperature?: number;
    schema?: Readonly<Record<string, unknown>>;
  }>;

  executionPolicy: Readonly<{
    timeoutMilliseconds: number;
    attemptNumber: number;
    maximumAuthorizedAttempts: number;
  }>;

  evidencePolicy: EvidencePolicy;

  requestHash: string;
}>;

// ---------------------------------------------------------------------------
// Provider testimony
// ---------------------------------------------------------------------------

export type ProviderDisposition =
  | "provider-responded"
  | "provider-rejected-request"
  | "provider-timed-out"
  | "provider-unavailable"
  | "provider-authentication-failed";

export type ProviderInvocationTestimony = Readonly<{
  invocationId: string;
  providerKind: ProviderKind;
  resolvedModel: string;

  disposition: ProviderDisposition;

  response?: Readonly<{
    text?: string;
    structuredValue?: unknown;
    finishReason?: string;
  }>;

  usage?: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;

  observation: Readonly<{
    startedAt: string;
    completedAt: string;
    durationMilliseconds: number;
    providerRequestId?: string;
  }>;

  providerFailure?: Readonly<{
    providerCode?: string;
    providerMessage?: string;
  }>;
}>;

export interface ModelProviderAdapter {
  readonly adapterId: string;
  readonly providerKind: ProviderKind;

  invokesProviderModel(
    context: ModelInvocationContext
  ): Promise<ProviderInvocationTestimony>;
}

// ---------------------------------------------------------------------------
// Public capability result
// ---------------------------------------------------------------------------

export type ResolvedAuthorityTestimony = Readonly<{
  providerAuthorityId: string;
  providerKind?: ProviderKind;
  modelAlias: string;
  resolvedModel?: string;
}>;

export type ModelExecutionReceipt = Readonly<{
  requestHash?: string;
  responseHash?: string;
  attemptCount: number;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
}>;

export type AttemptTestimony = Readonly<{
  attemptNumber: number;
  invocationId: string;
  disposition: ProviderDisposition;
  providerRequestId?: string;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
  providerFailure?: Readonly<{
    providerCode?: string;
    providerMessage?: string;
  }>;
}>;

export type ModelResponse = Readonly<{
  $schema?: string;
  requestId: string;
  invocationId?: string;
  disposition: ModelExecutionDisposition;

  resolvedAuthority?: ResolvedAuthorityTestimony;

  result?: Readonly<{
    format: ResponseFormat;
    text?: string;
    structuredValue?: unknown;
    finishReason?: string;
  }>;

  usage?: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;

  /** Why the connector reached a non-success disposition. */
  findings?: readonly Readonly<{
    code: string;
    detail: string;
    pointer?: string;
  }>[];

  /** One entry per authorized provider attempt actually performed. */
  attempts?: readonly AttemptTestimony[];

  proof: ModelExecutionReceipt;
}>;

// ---------------------------------------------------------------------------
// Runtime ports
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
  monotonicMilliseconds(): number;
}

export interface HashPort {
  hashes(value: unknown): string;
}

export interface IdentityPort {
  newInvocationId(): string;
}

export interface CredentialPort {
  readsCredential(name: string): string | undefined;
}

export type ModelConnectorDependencies = Readonly<{
  providerAuthorities: readonly ProviderAuthority[];
  providerAdapters: readonly ModelProviderAdapter[];
  clock: Clock;
  hashes: HashPort;
  identity: IdentityPort;
}>;
