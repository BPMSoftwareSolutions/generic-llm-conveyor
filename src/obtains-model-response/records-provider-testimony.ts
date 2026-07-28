import type {
  AttemptTestimony,
  ProviderInvocationTestimony,
} from "../shared/model-connector-contract.js";

/**
 * Captures the observed provider and model facts for one authorized attempt.
 *
 * Testimony is recorded whether the attempt succeeded or failed — a failed
 * attempt that leaves no trace is an unproven execution.
 */
export function recordsProviderTestimony(
  attemptNumber: number,
  testimony: ProviderInvocationTestimony
): AttemptTestimony {
  return Object.freeze({
    attemptNumber,
    invocationId: testimony.invocationId,
    disposition: testimony.disposition,
    providerRequestId: testimony.observation.providerRequestId,
    startedAt: testimony.observation.startedAt,
    completedAt: testimony.observation.completedAt,
    durationMilliseconds: testimony.observation.durationMilliseconds,
    providerFailure: testimony.providerFailure
      ? Object.freeze({ ...testimony.providerFailure })
      : undefined,
  });
}
