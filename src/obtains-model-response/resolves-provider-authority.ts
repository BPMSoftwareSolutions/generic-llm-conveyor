import type { ProviderAuthority } from "../shared/model-connector-contract.js";

export type ProviderAuthorityResolution =
  | Readonly<{ resolved: true; authority: ProviderAuthority }>
  | Readonly<{ resolved: false; detail: string }>;

/**
 * Chooses the declared provider configuration. Declared authority only —
 * this never guesses, defaults, or falls back to "the first provider".
 */
export function resolvesProviderAuthority(
  providerAuthorityId: string,
  providerAuthorities: readonly ProviderAuthority[]
): ProviderAuthorityResolution {
  const matches = providerAuthorities.filter(
    (authority) => authority.providerAuthorityId === providerAuthorityId
  );

  if (matches.length === 0) {
    return {
      resolved: false,
      detail: `No provider authority is declared with id "${providerAuthorityId}".`,
    };
  }

  if (matches.length > 1) {
    return {
      resolved: false,
      detail: `Provider authority id "${providerAuthorityId}" is declared ${matches.length} times; authority must be unambiguous.`,
    };
  }

  return { resolved: true, authority: matches[0]! };
}
