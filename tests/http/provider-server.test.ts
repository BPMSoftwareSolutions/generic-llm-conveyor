import assert from "node:assert/strict";
import { it } from "node:test";
import { createsProviderServer, listensOn } from "../../src/http/provider-server.js";
import { buildsDependencies, buildsValidRequest, createsRecordingAdapter, geminiAuthority } from "../acceptance/builds-connector-fixtures.js";

it("serves the circuit envelope and direct API with explicit success and failure", async () => {
  const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [{ disposition: "provider-responded", text: "hello" }]);
  const server = createsProviderServer(buildsDependencies([adapter], [geminiAuthority]));
  const base = await listensOn(server, "127.0.0.1", 0);
  try {
    const success = await fetch(`${base}/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handlerId: "obtain-model-response", input: buildsValidRequest() }) });
    const successBody = await success.json() as { output: { disposition: string; result: { text: string } } };
    assert.equal(success.status, 200);
    assert.equal(successBody.output.result.text, "hello");

    const invalid = await fetch(`${base}/v1/model-responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "bad" }) });
    const invalidBody = await invalid.json() as { disposition: string; proof: { attemptCount: number } };
    assert.equal(invalid.status, 422);
    assert.equal(invalidBody.disposition, "MODEL_REQUEST_REJECTED");
    assert.equal(invalidBody.proof.attemptCount, 0);
    assert.equal(adapter.invocationCount, 1);

    const substitution = buildsValidRequest({ executionPolicy: {
      timeoutMilliseconds: 1000,
      attemptAuthority: { maximumAuthorizedAttempts: 1 },
      providerSubstitution: { allowed: true },
    } });
    const denied = await fetch(`${base}/v1/model-responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(substitution) });
    const deniedBody = await denied.json() as { disposition: string; findings: { code: string }[] };
    assert.equal(denied.status, 422);
    assert.equal(deniedBody.disposition, "MODEL_REQUEST_REJECTED");
    assert.equal(deniedBody.findings[0]?.code, "PROVIDER_SUBSTITUTION_NOT_SUPPORTED");
    assert.equal(adapter.invocationCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it("reports provider failure as HTTP failure with the canonical receipt", async () => {
  const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [{ disposition: "provider-unavailable" }]);
  const server = createsProviderServer(buildsDependencies([adapter], [geminiAuthority]));
  const base = await listensOn(server, "127.0.0.1", 0);
  try {
    const response = await fetch(`${base}/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handlerId: "obtain-model-response", input: buildsValidRequest() }) });
    const body = await response.json() as { error: { code: string }; output: { proof: { attemptCount: number } } };
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "PROVIDER_UNAVAILABLE");
    assert.equal(body.output.proof.attemptCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
