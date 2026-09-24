import assert from "node:assert/strict";
import { it } from "node:test";
import { createsOpenAiAdapter } from "../../providers/openai/invokes-openai-model.js";
import type { HttpPort } from "../../providers/gemini/invokes-gemini-model.js";
import { obtainsModelResponse } from "../../src/obtains-model-response/obtains-model-response.js";
import { createsFixedClock } from "../../src/shared/runtime-ports.js";
import { buildsDependencies, buildsValidRequest, openaiAuthority } from "../acceptance/builds-connector-fixtures.js";

it("sends one authorized Responses API request and collects output across message items", async () => {
  let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  const http: HttpPort = async (url, init) => {
    sent = { url, headers: { ...init.headers }, body: JSON.parse(init.body) as Record<string, unknown> };
    return { status: 200, headers: { "x-request-id": "req-123" }, bodyText: JSON.stringify({
      id: "resp-123", status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "first" }] },
        { type: "message", content: [{ type: "output_text", text: " second" }] },
      ],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
    }) };
  };
  const adapter = createsOpenAiAdapter({ http, credentials: { readsCredential: () => "test-key" }, clock: createsFixedClock("2026-01-01T00:00:00Z") });
  const response = await obtainsModelResponse(buildsValidRequest({ providerAuthorityId: openaiAuthority.providerAuthorityId }),
    buildsDependencies([adapter], [openaiAuthority]));
  assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
  assert.equal(response.result?.text, "first second");
  assert.equal(response.usage?.totalTokens, 13);
  assert.equal(response.attempts?.[0]?.providerRequestId, "req-123");
  assert.equal(sent?.url, "https://api.openai.com/v1/responses");
  assert.equal(sent?.headers.authorization, "Bearer test-key");
  assert.equal(sent?.body.store, false);
  assert.equal(sent?.body.model, "gpt-4.1-mini");
});

it("maps authentication failure and never substitutes another provider", async () => {
  const http: HttpPort = async () => ({ status: 401, headers: {}, bodyText: JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid key." } }) });
  const adapter = createsOpenAiAdapter({ http, credentials: { readsCredential: () => "bad-key" }, clock: createsFixedClock("2026-01-01T00:00:00Z") });
  const response = await obtainsModelResponse(buildsValidRequest({ providerAuthorityId: openaiAuthority.providerAuthorityId }),
    buildsDependencies([adapter], [openaiAuthority]));
  assert.equal(response.disposition, "PROVIDER_AUTHENTICATION_FAILED");
  assert.equal(response.proof.attemptCount, 1);
  assert.equal(response.attempts?.[0]?.providerFailure?.providerCode, "invalid_api_key");
});

it("passes a declared JSON schema through the Responses API", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const http: HttpPort = async (_url, init) => {
    requestBody = JSON.parse(init.body) as Record<string, unknown>;
    return { status: 200, headers: {}, bodyText: JSON.stringify({ status: "completed", output: [
      { type: "message", content: [{ type: "output_text", text: "{\"answer\":\"yes\"}" }] },
    ] }) };
  };
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const adapter = createsOpenAiAdapter({ http, credentials: { readsCredential: () => "test-key" }, clock: createsFixedClock("2026-01-01T00:00:00Z") });
  const response = await obtainsModelResponse(buildsValidRequest({
    providerAuthorityId: openaiAuthority.providerAuthorityId,
    interaction: { mode: "structured-generation", messages: [{ role: "user", content: "Answer yes." }] },
    responsePolicy: { format: "json", maximumOutputTokens: 100, schema },
  }), buildsDependencies([adapter], [{ ...openaiAuthority, modelAliases: {
    "instruction-capable-model": { resolvedModel: "gpt-4.1-mini", supportedInteractionModes: ["structured-generation"] },
  } }]));
  assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
  assert.deepEqual(response.result?.structuredValue, { answer: "yes" });
  assert.deepEqual(requestBody?.text, { format: { type: "json_schema", name: "model_response", strict: true, schema } });
});
