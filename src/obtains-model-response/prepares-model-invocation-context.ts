import type {
  HashPort,
  IdentityPort,
  ModelAliasAuthority,
  ModelInvocationContext,
  ModelRequest,
  ProviderAuthority,
} from "../shared/model-connector-contract.js";

/**
 * Seals every resolved input into one immutable context before the provider
 * boundary is crossed. Adapters receive this and nothing else, which keeps
 * DTO stitching out of the execution path.
 */
export function preparesModelInvocationContext(
  request: ModelRequest,
  providerAuthority: ProviderAuthority,
  modelAuthority: ModelAliasAuthority,
  attemptNumber: number,
  identity: IdentityPort,
  hashes: HashPort
): ModelInvocationContext {
  const requestHash = hashes.hashes(canonicalRequestFacts(request));

  return Object.freeze({
    invocationId: identity.newInvocationId(),
    requestId: request.requestId,

    provider: Object.freeze({
      authorityId: providerAuthority.providerAuthorityId,
      kind: providerAuthority.providerKind,
      adapterId: providerAuthority.adapterId,
      endpoint:
        providerAuthority.endpointAuthority.mode === "explicit"
          ? providerAuthority.endpointAuthority.endpoint
          : undefined,
      credentialReference: Object.freeze({
        ...providerAuthority.credentialReference,
      }),
    }),

    model: Object.freeze({
      alias: request.modelAlias,
      resolvedName: modelAuthority.resolvedModel,
    }),

    interaction: Object.freeze({
      mode: request.interaction.mode,
      messages: Object.freeze(
        request.interaction.messages.map((message) =>
          Object.freeze({ role: message.role, content: message.content })
        )
      ),
    }),

    responsePolicy: Object.freeze({
      format: request.responsePolicy.format,
      maximumOutputTokens: request.responsePolicy.maximumOutputTokens,
      temperature: request.responsePolicy.temperature,
      schema: request.responsePolicy.schema,
    }),

    executionPolicy: Object.freeze({
      timeoutMilliseconds: request.executionPolicy.timeoutMilliseconds,
      attemptNumber,
      maximumAuthorizedAttempts:
        request.executionPolicy.attemptAuthority.maximumAuthorizedAttempts,
    }),

    evidencePolicy: Object.freeze({ ...request.evidencePolicy }),

    requestHash,
  });
}

/**
 * The facts that define the request's identity for hashing purposes.
 *
 * Deliberately excludes evidence policy and attempt number: the same semantic
 * request must hash identically regardless of how it is being observed or
 * which attempt is in flight.
 */
function canonicalRequestFacts(request: ModelRequest): unknown {
  return {
    requestId: request.requestId,
    providerAuthorityId: request.providerAuthorityId,
    modelAlias: request.modelAlias,
    interaction: {
      mode: request.interaction.mode,
      messages: request.interaction.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    },
    responsePolicy: {
      format: request.responsePolicy.format,
      maximumOutputTokens: request.responsePolicy.maximumOutputTokens,
      temperature: request.responsePolicy.temperature ?? null,
      schema: request.responsePolicy.schema ?? null,
    },
  };
}
