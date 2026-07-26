import type {
  ProviderDisposition,
  ProviderInvocationTestimony,
} from "../../src/shared/model-connector-contract.js";

export type GeminiObservation = Readonly<{
  invocationId: string;
  resolvedModel: string;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
  providerRequestId?: string;
}>;

/**
 * Translates a Gemini generateContent payload into canonical testimony.
 */
export function mapsGeminiSuccessTestimony(
  payload: unknown,
  observation: GeminiObservation
): ProviderInvocationTestimony {
  const candidate = firstCandidate(payload);
  const text = joinsCandidateText(candidate);
  const finishReason = readsString(candidate?.finishReason);

  // Gemini reports a stop reason even on a 200; a truncated or filtered
  // completion is a provider rejection, not a response.
  if (finishReason !== undefined && isBlockingFinishReason(finishReason)) {
    return buildsFailureTestimony(
      "provider-rejected-request",
      observation,
      finishReason,
      `Gemini terminated generation with finish reason "${finishReason}".`
    );
  }

  return Object.freeze({
    invocationId: observation.invocationId,
    providerKind: "gemini",
    resolvedModel: observation.resolvedModel,
    disposition: "provider-responded",
    response: Object.freeze({
      text,
      finishReason,
    }),
    usage: readsUsage(payload),
    observation: buildsObservation(observation),
  });
}

/**
 * Maps a Gemini HTTP failure into canonical testimony.
 *
 * The original provider code and message survive as observed testimony; the
 * connector classifies the canonical disposition from the status.
 */
export function mapsGeminiFailureTestimony(
  status: number,
  payload: unknown,
  observation: GeminiObservation
): ProviderInvocationTestimony {
  const error = readsErrorObject(payload);
  const providerCode = readsString(error?.status) ?? `HTTP_${status}`;
  const providerMessage =
    readsString(error?.message) ?? `Gemini responded with HTTP ${status}.`;

  return buildsFailureTestimony(
    classifiesGeminiStatus(status),
    observation,
    providerCode,
    providerMessage
  );
}

export function mapsGeminiTransportTestimony(
  error: unknown,
  observation: GeminiObservation
): ProviderInvocationTestimony {
  const timedOut =
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError");

  return buildsFailureTestimony(
    timedOut ? "provider-timed-out" : "provider-unavailable",
    observation,
    timedOut ? "REQUEST_TIMEOUT" : "TRANSPORT_FAILURE",
    error instanceof Error ? error.message : "Unknown transport failure."
  );
}

function buildsFailureTestimony(
  disposition: ProviderDisposition,
  observation: GeminiObservation,
  providerCode: string,
  providerMessage: string
): ProviderInvocationTestimony {
  return Object.freeze({
    invocationId: observation.invocationId,
    providerKind: "gemini",
    resolvedModel: observation.resolvedModel,
    disposition,
    observation: buildsObservation(observation),
    providerFailure: Object.freeze({ providerCode, providerMessage }),
  });
}

function buildsObservation(
  observation: GeminiObservation
): ProviderInvocationTestimony["observation"] {
  return Object.freeze({
    startedAt: observation.startedAt,
    completedAt: observation.completedAt,
    durationMilliseconds: observation.durationMilliseconds,
    providerRequestId: observation.providerRequestId,
  });
}

/**
 * HTTP status to provider disposition.
 *
 * 429 and 5xx both become "unavailable" — the distinction between quota and
 * outage is preserved in the provider code, not in the disposition.
 */
export function classifiesGeminiStatus(status: number): ProviderDisposition {
  if (status === 401 || status === 403) {
    return "provider-authentication-failed";
  }

  if (status === 408 || status === 504) {
    return "provider-timed-out";
  }

  if (status === 429 || status >= 500) {
    return "provider-unavailable";
  }

  return "provider-rejected-request";
}

function isBlockingFinishReason(finishReason: string): boolean {
  const normalized = finishReason.toUpperCase();

  return (
    normalized === "SAFETY" ||
    normalized === "RECITATION" ||
    normalized === "PROHIBITED_CONTENT" ||
    normalized === "BLOCKLIST" ||
    normalized === "SPII" ||
    normalized === "MALFORMED_FUNCTION_CALL" ||
    normalized === "MAX_TOKENS"
  );
}

function firstCandidate(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return undefined;
  }

  const candidate = payload.candidates[0];

  return isRecord(candidate) ? candidate : undefined;
}

function joinsCandidateText(
  candidate: Record<string, unknown> | undefined
): string | undefined {
  if (candidate === undefined || !isRecord(candidate.content)) {
    return undefined;
  }

  const parts = candidate.content.parts;

  if (!Array.isArray(parts)) {
    return undefined;
  }

  const text = parts
    .map((part) => (isRecord(part) ? readsString(part.text) : undefined))
    .filter((value): value is string => value !== undefined)
    .join("");

  return text.length > 0 ? text : undefined;
}

function readsUsage(
  payload: unknown
): ProviderInvocationTestimony["usage"] | undefined {
  if (!isRecord(payload) || !isRecord(payload.usageMetadata)) {
    return undefined;
  }

  const metadata = payload.usageMetadata;

  return Object.freeze({
    inputTokens: readsNumber(metadata.promptTokenCount),
    outputTokens: readsNumber(metadata.candidatesTokenCount),
    totalTokens: readsNumber(metadata.totalTokenCount),
  });
}

function readsErrorObject(
  payload: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  return payload.error;
}

function readsString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readsNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
