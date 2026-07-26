import type {
  InteractionMode,
  ModelAliasAuthority,
  ProviderAuthority,
} from "../shared/model-connector-contract.js";

export type ModelAliasResolution =
  | Readonly<{ resolved: true; model: ModelAliasAuthority }>
  | Readonly<{
      resolved: false;
      reason: "alias-not-found" | "interaction-mode-not-supported";
      detail: string;
    }>;

/**
 * Maps a semantic alias to a concrete provider model, and confirms the
 * declared interaction mode is supported by that alias.
 *
 * A capability request must not have to change because a provider model
 * version changed; that movement belongs to provider authority.
 */
export function resolvesModelAlias(
  modelAlias: string,
  interactionMode: InteractionMode,
  providerAuthority: ProviderAuthority
): ModelAliasResolution {
  const model = Object.prototype.hasOwnProperty.call(
    providerAuthority.modelAliases,
    modelAlias
  )
    ? providerAuthority.modelAliases[modelAlias]
    : undefined;

  if (model === undefined) {
    return {
      resolved: false,
      reason: "alias-not-found",
      detail: `Provider authority "${providerAuthority.providerAuthorityId}" does not map model alias "${modelAlias}".`,
    };
  }

  if (!model.supportedInteractionModes.includes(interactionMode)) {
    return {
      resolved: false,
      reason: "interaction-mode-not-supported",
      detail: `Model alias "${modelAlias}" does not support interaction mode "${interactionMode}".`,
    };
  }

  return { resolved: true, model };
}
