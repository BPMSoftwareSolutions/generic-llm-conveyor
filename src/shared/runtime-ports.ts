import { createHash, randomUUID } from "node:crypto";
import type {
  Clock,
  CredentialPort,
  HashPort,
  IdentityPort,
} from "./model-connector-contract.js";

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
  monotonicMilliseconds: () => Math.round(performance.now()),
});

/**
 * Deterministic hashing over a canonical JSON encoding.
 *
 * Object keys are emitted in sorted order so that two structurally identical
 * values hash identically regardless of construction order.
 */
export const sha256Hashes: HashPort = Object.freeze({
  hashes(value: unknown): string {
    const digest = createHash("sha256")
      .update(canonicalJson(value))
      .digest("hex");

    return `sha256:${digest}`;
  },
});

export const uuidIdentity: IdentityPort = Object.freeze({
  newInvocationId: () => `invocation-${randomUUID()}`,
});

export const environmentCredentials: CredentialPort = Object.freeze({
  readsCredential: (name: string) => process.env[name],
});

export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);

  return `{${entries.join(",")}}`;
}

/**
 * Fixed clock for tests and replay: timing observations become byte-stable.
 */
export function createsFixedClock(isoInstant: string, stepMilliseconds = 0): Clock {
  let tick = 0;

  return Object.freeze({
    now: () => new Date(isoInstant),
    monotonicMilliseconds: () => {
      const current = tick;
      tick += stepMilliseconds;
      return current;
    },
  });
}

/** Sequential identity for tests and replay. */
export function createsSequentialIdentity(prefix = "invocation"): IdentityPort {
  let counter = 0;

  return Object.freeze({
    newInvocationId: () => {
      counter += 1;
      return `${prefix}-${String(counter).padStart(4, "0")}`;
    },
  });
}
