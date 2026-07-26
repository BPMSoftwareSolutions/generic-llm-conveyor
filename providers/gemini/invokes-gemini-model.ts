import type {
  Clock,
  CredentialPort,
  ModelInvocationContext,
  ModelProviderAdapter,
  ProviderInvocationTestimony,
} from "../../src/shared/model-connector-contract.js";
import {
  buildsGeminiEndpointUrl,
  mapsContextToGeminiRequest,
} from "./maps-context-to-gemini-request.js";
import {
  mapsGeminiFailureTestimony,
  mapsGeminiSuccessTestimony,
  mapsGeminiTransportTestimony,
  type GeminiObservation,
} from "./maps-gemini-testimony.js";

export const GEMINI_ADAPTER_ID = "invokes-gemini-model";

/** Injected transport, so the adapter contract is provable without network. */
export type HttpPort = (
  url: string,
  init: Readonly<{
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  }>
) => Promise<
  Readonly<{
    status: number;
    headers: Readonly<Record<string, string>>;
    bodyText: string;
  }>
>;

export const fetchHttpPort: HttpPort = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
    signal: init.signal,
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    status: response.status,
    headers,
    bodyText: await response.text(),
  };
};

export type GeminiAdapterDependencies = Readonly<{
  http: HttpPort;
  credentials: CredentialPort;
  clock: Clock;
}>;

/**
 * Gemini protocol adapter.
 *
 * Owns transport and protocol translation only. It never decides whether to
 * retry, whether to substitute a provider, or what a response means.
 */
export function createsGeminiAdapter(
  dependencies: GeminiAdapterDependencies
): ModelProviderAdapter {
  return Object.freeze({
    adapterId: GEMINI_ADAPTER_ID,
    providerKind: "gemini",

    async invokesProviderModel(
      context: ModelInvocationContext
    ): Promise<ProviderInvocationTestimony> {
      const startedAt = dependencies.clock.now().toISOString();
      const startedTick = dependencies.clock.monotonicMilliseconds();

      const observes = (providerRequestId?: string): GeminiObservation => ({
        invocationId: context.invocationId,
        resolvedModel: context.model.resolvedName,
        startedAt,
        completedAt: dependencies.clock.now().toISOString(),
        durationMilliseconds:
          dependencies.clock.monotonicMilliseconds() - startedTick,
        providerRequestId,
      });

      const apiKey = dependencies.credentials.readsCredential(
        context.provider.credentialReference.name
      );

      if (apiKey === undefined || apiKey.length === 0) {
        return mapsGeminiFailureTestimony(
          401,
          {
            error: {
              status: "CREDENTIAL_NOT_AVAILABLE",
              message: `Environment credential "${context.provider.credentialReference.name}" is not available.`,
            },
          },
          observes()
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new DOMException("Timed out", "TimeoutError"));
      }, context.executionPolicy.timeoutMilliseconds);

      try {
        const response = await dependencies.http(
          buildsGeminiEndpointUrl(context),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(mapsContextToGeminiRequest(context)),
            signal: controller.signal,
          }
        );

        const payload = parsesJson(response.bodyText);
        const observation = observes(response.headers["x-request-id"]);

        if (response.status < 200 || response.status >= 300) {
          return mapsGeminiFailureTestimony(
            response.status,
            payload,
            observation
          );
        }

        return mapsGeminiSuccessTestimony(payload, observation);
      } catch (error) {
        return mapsGeminiTransportTestimony(error, observes());
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function parsesJson(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return { error: { status: "UNPARSEABLE_RESPONSE", message: bodyText } };
  }
}
