import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createsGeminiAdapter,
  type HttpPort,
} from "../../providers/gemini/invokes-gemini-model.js";
import { obtainsModelResponse } from "../../src/obtains-model-response/obtains-model-response.js";
import type {
  CredentialPort,
  ModelProviderAdapter,
} from "../../src/shared/model-connector-contract.js";
import { createsFixedClock } from "../../src/shared/runtime-ports.js";
import {
  buildsDependencies,
  buildsValidRequest,
  FIXED_INSTANT,
} from "../acceptance/builds-connector-fixtures.js";

/**
 * The contract every provider adapter must satisfy.
 *
 * When OpenAI, Anthropic, LiteLLM, and llama.cpp adapters arrive, they run
 * through verifiesProviderAdapterContract unchanged.
 */
export function verifiesProviderAdapterContract(
  adapterName: string,
  createsAdapter: () => ModelProviderAdapter
): void {
  describe(`Adapter contract: ${adapterName}`, () => {
    it("declares a stable adapter id and provider kind", () => {
      const adapter = createsAdapter();

      assert.equal(typeof adapter.adapterId, "string");
      assert.ok(adapter.adapterId.length > 0);
      assert.equal(adapter.adapterId, createsAdapter().adapterId);
      assert.equal(typeof adapter.providerKind, "string");
    });

    it("returns testimony rather than throwing on provider failure", async () => {
      const adapter = createsAdapter();
      const dependencies = buildsDependencies([adapter]);

      const response = await obtainsModelResponse(
        buildsValidRequest(),
        dependencies
      );

      // Whatever happened, the connector produced a governed disposition.
      assert.ok(response.disposition.length > 0);
      assert.ok(response.proof !== undefined);
    });
  });
}

const capturedRequests: { url: string; body: unknown; headers: Record<string, string> }[] =
  [];

function stubsHttp(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {}
): HttpPort {
  return async (url, init) => {
    capturedRequests.push({
      url,
      body: JSON.parse(init.body),
      headers: { ...init.headers },
    });

    return {
      status,
      headers,
      bodyText: typeof payload === "string" ? payload : JSON.stringify(payload),
    };
  };
}

const presentCredential: CredentialPort = {
  readsCredential: () => "test-api-key",
};

const absentCredential: CredentialPort = {
  readsCredential: () => undefined,
};

function buildsGeminiAdapter(
  http: HttpPort,
  credentials: CredentialPort = presentCredential
) {
  return createsGeminiAdapter({
    http,
    credentials,
    clock: createsFixedClock(FIXED_INSTANT, 1240),
  });
}

const SUCCESS_PAYLOAD = {
  candidates: [
    {
      content: { parts: [{ text: "The execution completed successfully." }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 217,
    candidatesTokenCount: 94,
    totalTokenCount: 311,
  },
};

// The shared contract, applied to the Gemini adapter.
verifiesProviderAdapterContract("gemini", () =>
  buildsGeminiAdapter(stubsHttp(200, SUCCESS_PAYLOAD))
);

describe("Gemini adapter: protocol translation", () => {
  it("obtains a normalized text response end to end", async () => {
    const adapter = buildsGeminiAdapter(stubsHttp(200, SUCCESS_PAYLOAD));

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
    assert.equal(response.result?.text, "The execution completed successfully.");
    assert.equal(response.result?.finishReason, "STOP");
    assert.deepEqual(response.usage, {
      inputTokens: 217,
      outputTokens: 94,
      totalTokens: 311,
    });
  });

  it("maps system messages to systemInstruction and targets the resolved model", async () => {
    capturedRequests.length = 0;
    const adapter = buildsGeminiAdapter(stubsHttp(200, SUCCESS_PAYLOAD));

    await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    const captured = capturedRequests.at(-1)!;
    const body = captured.body as Record<string, any>;

    assert.match(captured.url, /models\/gemini-flash-latest:generateContent$/);
    assert.equal(captured.headers["x-goog-api-key"], "test-api-key");

    // Gemini has no system role; the system message becomes an instruction.
    assert.equal(
      body.systemInstruction.parts[0].text,
      "Explain only what is supported by the supplied execution evidence."
    );
    assert.equal(body.contents.length, 1);
    assert.equal(body.contents[0].role, "user");
    assert.equal(body.generationConfig.maxOutputTokens, 1200);
    assert.equal(body.generationConfig.temperature, 0.1);
  });

  it("declares a response schema for a structured request", async () => {
    capturedRequests.length = 0;

    const adapter = buildsGeminiAdapter(
      stubsHttp(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    classification: "successful",
                    confidence: 0.94,
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
    );

    const request = buildsValidRequest({
      interaction: {
        mode: "structured-generation",
        messages: [{ role: "user", content: "Classify this receipt." }],
      },
      responsePolicy: {
        format: "json",
        maximumOutputTokens: 512,
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          required: ["classification", "confidence"],
          properties: {
            classification: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    const body = capturedRequests.at(-1)!.body as Record<string, any>;

    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseSchema.type, "object");

    // Gemini rejects unknown JSON Schema keywords.
    assert.ok(!("$schema" in body.generationConfig.responseSchema));
    assert.ok(!("additionalProperties" in body.generationConfig.responseSchema));

    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
    assert.deepEqual(response.result?.structuredValue, {
      classification: "successful",
      confidence: 0.94,
    });
  });

  it("keeps Gemini wire structures inside the adapter", async () => {
    const adapter = buildsGeminiAdapter(stubsHttp(200, SUCCESS_PAYLOAD));

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    const serialized = JSON.stringify(response);

    for (const wireKey of [
      "candidates",
      "usageMetadata",
      "generationConfig",
      "systemInstruction",
      "promptTokenCount",
    ]) {
      assert.ok(
        !serialized.includes(wireKey),
        `provider wire key "${wireKey}" leaked into the capability result`
      );
    }
  });
});

describe("Gemini adapter: failure classification", () => {
  const cases: readonly [number, string, string][] = [
    [401, "PROVIDER_AUTHENTICATION_FAILED", "UNAUTHENTICATED"],
    [403, "PROVIDER_AUTHENTICATION_FAILED", "PERMISSION_DENIED"],
    [400, "PROVIDER_REQUEST_REJECTED", "INVALID_ARGUMENT"],
    [404, "PROVIDER_REQUEST_REJECTED", "NOT_FOUND"],
    [429, "PROVIDER_UNAVAILABLE", "RESOURCE_EXHAUSTED"],
    [500, "PROVIDER_UNAVAILABLE", "INTERNAL"],
    [503, "PROVIDER_UNAVAILABLE", "UNAVAILABLE"],
    [504, "PROVIDER_TIMED_OUT", "DEADLINE_EXCEEDED"],
  ];

  for (const [status, expectedDisposition, providerStatus] of cases) {
    it(`maps HTTP ${status} (${providerStatus}) to ${expectedDisposition}`, async () => {
      const adapter = buildsGeminiAdapter(
        stubsHttp(status, {
          error: { status: providerStatus, message: `Gemini said ${status}.` },
        })
      );

      const response = await obtainsModelResponse(
        buildsValidRequest(),
        buildsDependencies([adapter])
      );

      assert.equal(response.disposition, expectedDisposition);

      // The provider-specific code survives as observed testimony.
      assert.equal(
        response.attempts?.[0]?.providerFailure?.providerCode,
        providerStatus
      );
      assert.equal(
        response.attempts?.[0]?.providerFailure?.providerMessage,
        `Gemini said ${status}.`
      );
    });
  }

  it("treats a missing credential as an authentication failure without calling out", async () => {
    let called = false;

    const adapter = buildsGeminiAdapter(async (url, init) => {
      called = true;
      return { status: 200, headers: {}, bodyText: "{}" };
    }, absentCredential);

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(called, false);
    assert.equal(response.disposition, "PROVIDER_AUTHENTICATION_FAILED");
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerCode,
      "CREDENTIAL_NOT_AVAILABLE"
    );
  });

  it("treats a transport abort as a timeout", async () => {
    const adapter = buildsGeminiAdapter(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    });

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "PROVIDER_TIMED_OUT");
  });

  it("treats a network error as provider unavailability", async () => {
    const adapter = buildsGeminiAdapter(async () => {
      throw new Error("ECONNREFUSED");
    });

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "PROVIDER_UNAVAILABLE");
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerCode,
      "TRANSPORT_FAILURE"
    );
  });

  it("treats a safety-blocked completion as a provider rejection", async () => {
    const adapter = buildsGeminiAdapter(
      stubsHttp(200, {
        candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
      })
    );

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    // A 200 with a blocking stop reason is not a response.
    assert.equal(response.disposition, "PROVIDER_REQUEST_REJECTED");
  });

  it("treats a truncated completion as a provider rejection", async () => {
    const adapter = buildsGeminiAdapter(
      stubsHttp(200, {
        candidates: [
          {
            content: { parts: [{ text: "partial" }] },
            finishReason: "MAX_TOKENS",
          },
        ],
      })
    );

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "PROVIDER_REQUEST_REJECTED");
  });

  it("classifies an unparseable body without leaking it into the result", async () => {
    const adapter = buildsGeminiAdapter(
      stubsHttp(502, "<html>Bad Gateway</html>")
    );

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "PROVIDER_UNAVAILABLE");
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerCode,
      "UNPARSEABLE_RESPONSE"
    );
  });
});
