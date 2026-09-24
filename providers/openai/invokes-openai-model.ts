import type {
  Clock, CredentialPort, ModelInvocationContext, ModelProviderAdapter,
  ProviderDisposition, ProviderInvocationTestimony,
} from "../../src/shared/model-connector-contract.js";
import type { HttpPort } from "../gemini/invokes-gemini-model.js";

export const OPENAI_ADAPTER_ID = "invokes-openai-model";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

export function createsOpenAiAdapter(dependencies: Readonly<{
  http: HttpPort;
  credentials: CredentialPort;
  clock: Clock;
}>): ModelProviderAdapter {
  return Object.freeze({
    adapterId: OPENAI_ADAPTER_ID,
    providerKind: "openai",
    async invokesProviderModel(context: ModelInvocationContext): Promise<ProviderInvocationTestimony> {
      const startedAt = dependencies.clock.now().toISOString();
      const startedTick = dependencies.clock.monotonicMilliseconds();
      const observes = (providerRequestId?: string) => ({
        startedAt,
        completedAt: dependencies.clock.now().toISOString(),
        durationMilliseconds: dependencies.clock.monotonicMilliseconds() - startedTick,
        providerRequestId,
      });
      const fails = (disposition: ProviderDisposition, code: string, message: string, providerRequestId?: string): ProviderInvocationTestimony => ({
        invocationId: context.invocationId,
        providerKind: "openai",
        resolvedModel: context.model.resolvedName,
        disposition,
        observation: observes(providerRequestId),
        providerFailure: { providerCode: code, providerMessage: message },
      });
      const apiKey = dependencies.credentials.readsCredential(context.provider.credentialReference.name);
      if (!apiKey) {
        return fails("provider-authentication-failed", "CREDENTIAL_NOT_AVAILABLE",
          `Environment credential "${context.provider.credentialReference.name}" is not available.`);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")),
        context.executionPolicy.timeoutMilliseconds);
      try {
        const body: Record<string, unknown> = {
          model: context.model.resolvedName,
          input: context.interaction.messages.map(message => ({ role: message.role, content: message.content })),
          max_output_tokens: context.responsePolicy.maximumOutputTokens,
          store: false,
        };
        if (context.responsePolicy.temperature !== undefined) body.temperature = context.responsePolicy.temperature;
        if (context.responsePolicy.format === "json") {
          body.text = { format: {
            type: "json_schema", name: "model_response", strict: true,
            schema: context.responsePolicy.schema,
          } };
        }
        const response = await dependencies.http(context.provider.endpoint ?? DEFAULT_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const providerRequestId = response.headers["x-request-id"];
        let payload: unknown;
        try { payload = JSON.parse(response.bodyText); }
        catch { return fails("provider-unavailable", "UNPARSEABLE_RESPONSE", "OpenAI returned invalid JSON.", providerRequestId); }
        if (response.status < 200 || response.status >= 300) {
          const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
          const code = readsString(error.code) ?? readsString(error.type) ?? `HTTP_${response.status}`;
          const message = readsString(error.message) ?? `OpenAI returned HTTP ${response.status}.`;
          return fails(classifiesStatus(response.status), code, message, providerRequestId);
        }
        if (!isRecord(payload)) return fails("provider-unavailable", "INVALID_RESPONSE", "OpenAI returned a non-object response.", providerRequestId);
        const status = readsString(payload.status);
        if (status !== "completed") {
          const reason = isRecord(payload.incomplete_details) ? readsString(payload.incomplete_details.reason) : undefined;
          return fails("provider-rejected-request", status ?? "INVALID_RESPONSE",
            reason ? `OpenAI response was ${status}: ${reason}.` : `OpenAI response was ${status ?? "missing status"}.`, providerRequestId);
        }
        const text = readsOutputText(payload);
        if (text === undefined) {
          return fails("provider-rejected-request", "OUTPUT_TEXT_MISSING", "OpenAI returned no output text.", providerRequestId);
        }
        const usage = isRecord(payload.usage) ? payload.usage : {};
        return {
          invocationId: context.invocationId,
          providerKind: "openai",
          resolvedModel: context.model.resolvedName,
          disposition: "provider-responded",
          response: { text, finishReason: status },
          usage: {
            inputTokens: readsNumber(usage.input_tokens),
            outputTokens: readsNumber(usage.output_tokens),
            totalTokens: readsNumber(usage.total_tokens),
          },
          observation: observes(providerRequestId ?? readsString(payload.id)),
        };
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
        return fails(timedOut ? "provider-timed-out" : "provider-unavailable",
          timedOut ? "REQUEST_TIMEOUT" : "TRANSPORT_FAILURE",
          error instanceof Error ? error.message : "Unknown transport failure.");
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function readsOutputText(payload: Record<string, unknown>): string | undefined {
  if (!Array.isArray(payload.output)) return undefined;
  const parts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.length ? parts.join("") : undefined;
}

function classifiesStatus(status: number): ProviderDisposition {
  if (status === 401 || status === 403) return "provider-authentication-failed";
  if (status === 408 || status === 504) return "provider-timed-out";
  if (status === 429 || status >= 500) return "provider-unavailable";
  return "provider-rejected-request";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readsString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function readsNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
