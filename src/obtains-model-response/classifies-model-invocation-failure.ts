import type {
  ModelExecutionDisposition,
  ProviderDisposition,
} from "../shared/model-connector-contract.js";

/**
 * Maps provider dispositions into the stable canonical vocabulary.
 *
 * Provider-specific errors (HTTP 429, Gemini RESOURCE_EXHAUSTED, OpenAI
 * rate_limit_exceeded) survive as observed testimony; downstream consumers
 * decide on the canonical disposition.
 */
export function classifiesModelInvocationFailure(
  providerDisposition: ProviderDisposition
): ModelExecutionDisposition {
  switch (providerDisposition) {
    case "provider-responded":
      return "MODEL_RESPONSE_OBTAINED";
    case "provider-rejected-request":
      return "PROVIDER_REQUEST_REJECTED";
    case "provider-timed-out":
      return "PROVIDER_TIMED_OUT";
    case "provider-unavailable":
      return "PROVIDER_UNAVAILABLE";
    case "provider-authentication-failed":
      return "PROVIDER_AUTHENTICATION_FAILED";
    default: {
      const exhaustive: never = providerDisposition;
      void exhaustive;
      return "INTERNAL_EXECUTION_FAILED";
    }
  }
}

/**
 * Whether a provider disposition is transient under the declared
 * continuation rule. Only these justify consuming another authorized attempt.
 */
export function isTransientProviderFailure(
  providerDisposition: ProviderDisposition
): boolean {
  return (
    providerDisposition === "provider-unavailable" ||
    providerDisposition === "provider-timed-out"
  );
}
