import type {
  ModelInvocationContext,
  ModelProviderAdapter,
  ProviderInvocationTestimony,
} from "../shared/model-connector-contract.js";

export class AdapterNotRegisteredError extends Error {
  constructor(readonly adapterId: string) {
    super(`No provider adapter is registered with id "${adapterId}".`);
    this.name = "AdapterNotRegisteredError";
  }
}

/**
 * Performs exactly one invocation per authorized attempt.
 *
 * There is no loop here and no error swallowing here. Attempt authority is
 * enforced by the caller so that every attempt produces its own testimony.
 */
export async function invokesProviderAdapter(
  context: ModelInvocationContext,
  providerAdapters: readonly ModelProviderAdapter[]
): Promise<ProviderInvocationTestimony> {
  const adapter = providerAdapters.find(
    (candidate) => candidate.adapterId === context.provider.adapterId
  );

  if (adapter === undefined) {
    throw new AdapterNotRegisteredError(context.provider.adapterId);
  }

  if (adapter.providerKind !== context.provider.kind) {
    throw new AdapterNotRegisteredError(context.provider.adapterId);
  }

  return adapter.invokesProviderModel(context);
}
