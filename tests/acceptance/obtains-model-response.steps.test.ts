import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { obtainsModelResponse } from "../../src/obtains-model-response/obtains-model-response.js";
import {
  buildsDependencies,
  buildsValidRequest,
  createsRecordingAdapter,
  geminiAuthority,
  openaiAuthority,
} from "./builds-connector-fixtures.js";

/**
 * Acceptance is governed by acceptance/obtains-model-response.feature.
 * Each describe block below is one scenario from that file, in order.
 */

describe("Scenario: Obtain a text response from a resolved provider", () => {
  it("invokes the declared adapter exactly once and returns a proven response", async () => {
    // Given a valid model request
    const request = buildsValidRequest();

    // And the declared provider authority exists
    // And the declared model alias resolves to a supported model
    // And one provider attempt is authorized
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-responded",
        text: "The execution completed successfully.",
        usage: { inputTokens: 217, outputTokens: 94, totalTokens: 311 },
      },
    ]);

    // When the model response is obtained
    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // Then the declared provider adapter is invoked exactly once
    assert.equal(adapter.invocationCount, 1);

    // And the response disposition is "MODEL_RESPONSE_OBTAINED"
    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");

    // And the response identifies the resolved provider
    assert.equal(
      response.resolvedAuthority?.providerAuthorityId,
      "primary-cognitive-provider"
    );
    assert.equal(response.resolvedAuthority?.providerKind, "gemini");

    // And the response identifies the resolved model
    assert.equal(response.resolvedAuthority?.modelAlias, "instruction-capable-model");
    assert.equal(response.resolvedAuthority?.resolvedModel, "gemini-flash-latest");

    // And the execution receipt contains the request hash
    assert.match(response.proof.requestHash ?? "", /^sha256:[0-9a-f]{64}$/);

    // And the execution receipt contains the response hash
    assert.match(response.proof.responseHash ?? "", /^sha256:[0-9a-f]{64}$/);

    assert.equal(response.result?.format, "text");
    assert.equal(response.result?.text, "The execution completed successfully.");
    assert.deepEqual(response.usage, {
      inputTokens: 217,
      outputTokens: 94,
      totalTokens: 311,
    });
    assert.equal(response.proof.attemptCount, 1);
  });
});

describe("Scenario: Reject an unknown provider authority", () => {
  it("fails before any adapter is invoked", async () => {
    // Given a valid model request
    // And the declared provider authority does not exist
    const request = buildsValidRequest({
      providerAuthorityId: "provider-authority-that-was-never-declared",
    });

    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "unreachable" },
    ]);

    // When the model response is requested
    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // Then no provider adapter is invoked
    assert.equal(adapter.invocationCount, 0);

    // And the response disposition is "PROVIDER_AUTHORITY_NOT_FOUND"
    assert.equal(response.disposition, "PROVIDER_AUTHORITY_NOT_FOUND");
    assert.equal(response.proof.attemptCount, 0);
    assert.equal(response.findings?.[0]?.code, "PROVIDER_AUTHORITY_NOT_FOUND");
  });
});

describe("Scenario: Reject an unresolved model alias", () => {
  it("fails before any adapter is invoked", async () => {
    // Given a valid model request
    // And the declared provider authority exists
    // And the declared model alias is not mapped
    const request = buildsValidRequest({
      modelAlias: "model-alias-that-was-never-mapped",
    });

    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "unreachable" },
    ]);

    // When the model response is requested
    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // Then no provider adapter is invoked
    assert.equal(adapter.invocationCount, 0);

    // And the response disposition is "MODEL_ALIAS_NOT_FOUND"
    assert.equal(response.disposition, "MODEL_ALIAS_NOT_FOUND");
    assert.equal(response.proof.attemptCount, 0);
  });
});

describe("Scenario: Prevent silent provider substitution", () => {
  it("invokes only the authorized provider when it is unavailable", async () => {
    // Given a model request authorizes only the Gemini provider
    const request = buildsValidRequest();

    // And the Gemini provider is unavailable
    const geminiAdapter = createsRecordingAdapter(
      "invokes-gemini-model",
      "gemini",
      [
        {
          disposition: "provider-unavailable",
          providerCode: "RESOURCE_EXHAUSTED",
          providerMessage: "Gemini quota exceeded.",
        },
      ]
    );

    const openaiAdapter = createsRecordingAdapter(
      "invokes-openai-model",
      "openai",
      [{ disposition: "provider-responded", text: "must never be reached" }]
    );

    // When the model response is requested
    const response = await obtainsModelResponse(
      request,
      buildsDependencies(
        [geminiAdapter, openaiAdapter],
        [geminiAuthority, openaiAuthority]
      )
    );

    // Then the Gemini adapter is invoked exactly once
    assert.equal(geminiAdapter.invocationCount, 1);

    // And no other provider adapter is invoked
    assert.equal(openaiAdapter.invocationCount, 0);

    // And the response disposition is "PROVIDER_UNAVAILABLE"
    assert.equal(response.disposition, "PROVIDER_UNAVAILABLE");

    // The original provider error survives as observed testimony.
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerCode,
      "RESOURCE_EXHAUSTED"
    );
  });
});

describe("Scenario: Stop after the authorized attempt count", () => {
  it("consumes exactly the authorized attempts and records each one", async () => {
    // Given a model request authorizes two attempts
    const request = buildsValidRequest({
      executionPolicy: {
        timeoutMilliseconds: 60000,
        attemptAuthority: {
          maximumAuthorizedAttempts: 2,
          continuationRule:
            "continue-while-provider-reports-transient-failure",
        },
        providerSubstitution: { allowed: false },
      },
    });

    // And the provider reports a transient failure for both attempts
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-unavailable",
        providerCode: "UNAVAILABLE",
        providerMessage: "Gemini is temporarily unavailable.",
      },
    ]);

    // When the model response is requested
    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // Then the provider adapter is invoked exactly twice
    assert.equal(adapter.invocationCount, 2);

    // And two provider attempt testimonies are recorded
    assert.equal(response.attempts?.length, 2);
    assert.equal(response.attempts?.[0]?.attemptNumber, 1);
    assert.equal(response.attempts?.[1]?.attemptNumber, 2);
    assert.equal(response.proof.attemptCount, 2);

    // Each attempt is its own invocation.
    assert.notEqual(
      response.attempts?.[0]?.invocationId,
      response.attempts?.[1]?.invocationId
    );

    // And the response disposition is "ATTEMPT_AUTHORITY_EXHAUSTED"
    assert.equal(response.disposition, "ATTEMPT_AUTHORITY_EXHAUSTED");
  });
});

describe("Scenario: Reject a response that violates the required format", () => {
  it("rejects the format and represents the invalid payload only by hash", async () => {
    // Given a model request requires a structured response
    const request = buildsValidRequest({
      interaction: {
        mode: "structured-generation",
        messages: [{ role: "user", content: "Classify this execution receipt." }],
      },
      responsePolicy: {
        format: "json",
        maximumOutputTokens: 512,
        temperature: 0,
        schema: {
          type: "object",
          required: ["classification", "confidence"],
          properties: {
            classification: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    });

    // And the provider returns text that cannot satisfy the declared schema
    const invalidPayload = "This is prose, not the declared JSON shape.";

    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: invalidPayload },
    ]);

    // When the model response is normalized
    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // Then the response disposition is "RESPONSE_FORMAT_NOT_SATISFIED"
    assert.equal(response.disposition, "RESPONSE_FORMAT_NOT_SATISFIED");

    // And the invalid provider response is represented only by its evidence hash
    assert.match(response.proof.responseHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(response.result, undefined);

    const serialized = JSON.stringify(response);
    assert.ok(
      !serialized.includes(invalidPayload),
      "the invalid provider payload must not appear in the receipt"
    );
  });

  it("rejects structured output that parses but violates the declared schema", async () => {
    const request = buildsValidRequest({
      interaction: {
        mode: "structured-generation",
        messages: [{ role: "user", content: "Classify this execution receipt." }],
      },
      responsePolicy: {
        format: "json",
        maximumOutputTokens: 512,
        schema: {
          type: "object",
          required: ["classification", "confidence"],
          properties: {
            classification: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    });

    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-responded",
        text: JSON.stringify({ classification: "successful" }),
      },
    ]);

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "RESPONSE_FORMAT_NOT_SATISFIED");
    assert.match(response.findings?.[0]?.detail ?? "", /confidence/);
  });

  it("rejects structured output that violates declared closed identity constraints", async () => {
    const request = buildsValidRequest({
      interaction: {
        mode: "structured-generation",
        messages: [{ role: "user", content: "Resolve one canonical scenario input." }],
      },
      responsePolicy: {
        format: "json",
        maximumOutputTokens: 512,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["inputId", "contractId", "semanticFacts"],
          properties: {
            inputId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            contractId: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]*\\.v[0-9]+$" },
            semanticFacts: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          },
        },
      },
    });
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [{
      disposition: "provider-responded",
      structuredValue: {
        inputId: "valid-input",
        contractId: "missing-version",
        semanticFacts: ["One fact exists."],
      },
    }]);

    const response = await obtainsModelResponse(request, buildsDependencies([adapter]));

    assert.equal(response.disposition, "RESPONSE_FORMAT_NOT_SATISFIED");
    assert.match(response.findings?.[0]?.detail ?? "", /contractId.*pattern/);
  });

  it("accepts structured output that satisfies the declared schema", async () => {
    const request = buildsValidRequest({
      interaction: {
        mode: "structured-generation",
        messages: [{ role: "user", content: "Classify this execution receipt." }],
      },
      responsePolicy: {
        format: "json",
        maximumOutputTokens: 512,
        schema: {
          type: "object",
          required: ["classification", "confidence"],
          properties: {
            classification: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    });

    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-responded",
        text: JSON.stringify({ classification: "successful", confidence: 0.94 }),
      },
    ]);

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
    assert.deepEqual(response.result?.structuredValue, {
      classification: "successful",
      confidence: 0.94,
    });
  });
});
