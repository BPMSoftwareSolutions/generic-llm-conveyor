import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createsGeminiAdapter, fetchHttpPort, GEMINI_ADAPTER_ID } from "../../providers/gemini/invokes-gemini-model.js";
import { createsOpenAiAdapter, OPENAI_ADAPTER_ID } from "../../providers/openai/invokes-openai-model.js";
import type { ModelConnectorDependencies, ProviderAuthority } from "./model-connector-contract.js";
import { environmentCredentials, sha256Hashes, systemClock, uuidIdentity } from "./runtime-ports.js";

const adapters = [
  createsGeminiAdapter({ http: fetchHttpPort, credentials: environmentCredentials, clock: systemClock }),
  createsOpenAiAdapter({ http: fetchHttpPort, credentials: environmentCredentials, clock: systemClock }),
] as const;

/** Config is declared in a file. Requests may select only a registered authority and alias. */
export async function loadsProviderAuthorities(path: string): Promise<readonly ProviderAuthority[]> {
  const file = resolve(path);
  const loaded: unknown = JSON.parse(await readFile(file, "utf8"));
  const authorities = Array.isArray(loaded) ? loaded :
    isRecord(loaded) && Array.isArray(loaded.providerAuthorities) ? loaded.providerAuthorities : [loaded];
  if (authorities.length === 0) throw new Error(`Authority file "${file}" declares no providers.`);
  const ids = new Set<string>();
  for (const authority of authorities) {
    if (!isRecord(authority) || typeof authority.providerAuthorityId !== "string" || !authority.providerAuthorityId ||
        typeof authority.providerKind !== "string" || typeof authority.adapterId !== "string" ||
        !isRecord(authority.credentialReference) || authority.credentialReference.source !== "environment" ||
        typeof authority.credentialReference.name !== "string" || !authority.credentialReference.name ||
        !isRecord(authority.endpointAuthority) || !["provider-default", "explicit"].includes(String(authority.endpointAuthority.mode)) ||
        !isRecord(authority.modelAliases) || Object.keys(authority.modelAliases).length === 0 ||
        ids.has(authority.providerAuthorityId)) {
      throw new Error(`Authority file "${file}" has an invalid or duplicate provider declaration.`);
    }
    if (!isRecord(authority.capabilities) ||
        ["supportsUsageReporting", "supportsStructuredOutput", "supportsStreaming"].some(flag =>
          typeof (authority.capabilities as Record<string, unknown>)[flag] !== "boolean")) {
      throw new Error(`Authority ${authority.providerAuthorityId} has invalid capability declarations.`);
    }
    if (authority.endpointAuthority.mode === "explicit" &&
        (typeof authority.endpointAuthority.endpoint !== "string" || !isHttpUrl(authority.endpointAuthority.endpoint))) {
      throw new Error(`Authority ${authority.providerAuthorityId} needs an explicit HTTP endpoint.`);
    }
    if ((authority.providerKind === "gemini" && authority.adapterId !== GEMINI_ADAPTER_ID) ||
        (authority.providerKind === "openai" && authority.adapterId !== OPENAI_ADAPTER_ID) ||
        !adapters.some(adapter => adapter.adapterId === authority.adapterId && adapter.providerKind === authority.providerKind)) {
      throw new Error(`Authority ${authority.providerAuthorityId} has no matching registered adapter.`);
    }
    for (const [alias, model] of Object.entries(authority.modelAliases)) {
      if (!alias || !isRecord(model) || typeof model.resolvedModel !== "string" || !model.resolvedModel ||
          !Array.isArray(model.supportedInteractionModes) || !model.supportedInteractionModes.length ||
          !model.supportedInteractionModes.every(mode => ["text-generation", "structured-generation"].includes(mode))) {
        throw new Error(`Authority ${authority.providerAuthorityId} has invalid model alias ${alias}.`);
      }
    }
    ids.add(authority.providerAuthorityId);
  }
  return authorities as ProviderAuthority[];
}

export function createsRuntimeDependencies(providerAuthorities: readonly ProviderAuthority[]): ModelConnectorDependencies {
  return { providerAuthorities, providerAdapters: adapters, clock: systemClock, hashes: sha256Hashes, identity: uuidIdentity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isHttpUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}
