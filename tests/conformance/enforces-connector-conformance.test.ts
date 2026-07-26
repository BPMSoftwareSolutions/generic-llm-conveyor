import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISPOSITION_EXIT_CODES,
  MODEL_EXECUTION_DISPOSITIONS,
} from "../../src/shared/model-connector-contract.js";
import { obtainsModelResponse } from "../../src/obtains-model-response/obtains-model-response.js";
import { canonicalJson, sha256Hashes } from "../../src/shared/runtime-ports.js";
import {
  buildsDependencies,
  buildsValidRequest,
  createsRecordingAdapter,
  geminiAuthority,
  openaiAuthority,
} from "../acceptance/builds-connector-fixtures.js";

describe("Conformance: enforces exactly one adapter invocation", () => {
  it("invokes the adapter once for a single authorized attempt", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "ok" },
    ]);

    await obtainsModelResponse(buildsValidRequest(), buildsDependencies([adapter]));

    assert.equal(adapter.invocationCount, 1);
  });

  it("never exceeds the declared maximum authorized attempts", async () => {
    for (const maximumAuthorizedAttempts of [1, 2, 3]) {
      const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
        { disposition: "provider-unavailable" },
      ]);

      const request = buildsValidRequest({
        executionPolicy: {
          timeoutMilliseconds: 60000,
          attemptAuthority: {
            maximumAuthorizedAttempts,
            continuationRule:
              "continue-while-provider-reports-transient-failure",
          },
          providerSubstitution: { allowed: false },
        },
      });

      const response = await obtainsModelResponse(
        request,
        buildsDependencies([adapter])
      );

      assert.equal(adapter.invocationCount, maximumAuthorizedAttempts);
      assert.equal(response.proof.attemptCount, maximumAuthorizedAttempts);
    }
  });

  it("does not consume a second attempt for a non-transient failure", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-authentication-failed" },
    ]);

    const request = buildsValidRequest({
      executionPolicy: {
        timeoutMilliseconds: 60000,
        attemptAuthority: {
          maximumAuthorizedAttempts: 3,
          continuationRule: "continue-while-provider-reports-transient-failure",
        },
        providerSubstitution: { allowed: false },
      },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    // An authentication failure will not resolve itself; spending further
    // authorized attempts on it would be a hidden retry.
    assert.equal(adapter.invocationCount, 1);
    assert.equal(response.disposition, "PROVIDER_AUTHENTICATION_FAILED");
  });

  it("does not repeat an attempt without a declared continuation rule", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-unavailable" },
    ]);

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(adapter.invocationCount, 1);
    assert.equal(response.disposition, "PROVIDER_UNAVAILABLE");
  });
});

describe("Conformance: prevents provider substitution", () => {
  it("never invokes an adapter belonging to another authority", async () => {
    const geminiAdapter = createsRecordingAdapter(
      "invokes-gemini-model",
      "gemini",
      [{ disposition: "provider-unavailable" }]
    );

    const openaiAdapter = createsRecordingAdapter(
      "invokes-openai-model",
      "openai",
      [{ disposition: "provider-responded", text: "must never be reached" }]
    );

    for (const disposition of [
      "provider-unavailable",
      "provider-timed-out",
      "provider-authentication-failed",
      "provider-rejected-request",
    ] as const) {
      const failing = createsRecordingAdapter("invokes-gemini-model", "gemini", [
        { disposition },
      ]);

      await obtainsModelResponse(
        buildsValidRequest(),
        buildsDependencies(
          [failing, openaiAdapter],
          [geminiAuthority, openaiAuthority]
        )
      );

      assert.equal(failing.invocationCount, 1);
      assert.equal(openaiAdapter.invocationCount, 0);
    }

    void geminiAdapter;
  });

  it("refuses an adapter whose provider kind contradicts the authority", async () => {
    // A registered adapter id that reports the wrong kind is a governance
    // error, not a transport error.
    const mismatched = createsRecordingAdapter(
      "invokes-gemini-model",
      "openai",
      [{ disposition: "provider-responded", text: "ok" }]
    );

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([mismatched])
    );

    assert.equal(response.disposition, "INTERNAL_EXECUTION_FAILED");
  });

  it("fails when no adapter is registered for the declared authority", async () => {
    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([])
    );

    assert.equal(response.disposition, "INTERNAL_EXECUTION_FAILED");
    assert.match(
      response.findings?.[0]?.detail ?? "",
      /invokes-gemini-model/
    );
  });
});

describe("Conformance: preserves provider testimony", () => {
  it("preserves the original provider error alongside the canonical disposition", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-unavailable",
        providerCode: "RESOURCE_EXHAUSTED",
        providerMessage: "Quota exceeded for requests per minute.",
      },
    ]);

    const response = await obtainsModelResponse(
      buildsValidRequest(),
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "PROVIDER_UNAVAILABLE");
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerCode,
      "RESOURCE_EXHAUSTED"
    );
    assert.equal(
      response.attempts?.[0]?.providerFailure?.providerMessage,
      "Quota exceeded for requests per minute."
    );
  });

  it("records testimony for every attempt, including failed ones", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-timed-out", providerCode: "DEADLINE_EXCEEDED" },
      { disposition: "provider-responded", text: "recovered" },
    ]);

    const request = buildsValidRequest({
      executionPolicy: {
        timeoutMilliseconds: 60000,
        attemptAuthority: {
          maximumAuthorizedAttempts: 2,
          continuationRule: "continue-while-provider-reports-transient-failure",
        },
        providerSubstitution: { allowed: false },
      },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
    assert.equal(response.attempts?.length, 2);
    assert.equal(response.attempts?.[0]?.disposition, "provider-timed-out");
    assert.equal(response.attempts?.[1]?.disposition, "provider-responded");
  });

  it("seals the invocation context handed to the adapter", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "ok" },
    ]);

    await obtainsModelResponse(buildsValidRequest(), buildsDependencies([adapter]));

    const context = adapter.receivedContexts[0]!;

    assert.ok(Object.isFrozen(context));
    assert.ok(Object.isFrozen(context.provider));
    assert.ok(Object.isFrozen(context.model));
    assert.ok(Object.isFrozen(context.interaction));
    assert.ok(Object.isFrozen(context.interaction.messages));

    // The adapter receives a resolved model and a credential reference —
    // never a credential value.
    assert.equal(context.model.resolvedName, "gemini-flash-latest");
    assert.equal(context.provider.credentialReference.name, "GEMINI_API_KEY");
    assert.ok(!("apiKey" in context.provider));
  });
});

describe("Conformance: produces byte-stable failure dispositions", () => {
  it("replays the same invalid input to byte-identical findings", async () => {
    const invalidRequest = {
      requestId: "byte-stability-001",
      providerAuthorityId: "",
      modelAlias: "",
      interaction: { mode: "not-a-mode", messages: [] },
      responsePolicy: { format: "xml", maximumOutputTokens: 0 },
      executionPolicy: {},
      evidencePolicy: {},
    };

    const first = await obtainsModelResponse(
      invalidRequest,
      buildsDependencies([])
    );
    const second = await obtainsModelResponse(
      invalidRequest,
      buildsDependencies([])
    );

    assert.equal(first.disposition, "MODEL_REQUEST_REJECTED");
    assert.equal(canonicalJson(first), canonicalJson(second));
  });

  it("hashes the same semantic request identically regardless of key order", async () => {
    const adapterA = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "ok" },
    ]);
    const adapterB = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "ok" },
    ]);

    const base = buildsValidRequest();

    const reordered = {
      evidencePolicy: base.evidencePolicy,
      executionPolicy: base.executionPolicy,
      responsePolicy: base.responsePolicy,
      interaction: base.interaction,
      modelAlias: base.modelAlias,
      providerAuthorityId: base.providerAuthorityId,
      requestId: base.requestId,
    };

    const first = await obtainsModelResponse(base, buildsDependencies([adapterA]));
    const second = await obtainsModelResponse(
      reordered,
      buildsDependencies([adapterB])
    );

    assert.equal(first.proof.requestHash, second.proof.requestHash);
  });

  it("keeps the request hash stable across attempts of one execution", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-unavailable" },
    ]);

    const request = buildsValidRequest({
      executionPolicy: {
        timeoutMilliseconds: 60000,
        attemptAuthority: {
          maximumAuthorizedAttempts: 3,
          continuationRule: "continue-while-provider-reports-transient-failure",
        },
        providerSubstitution: { allowed: false },
      },
    });

    await obtainsModelResponse(request, buildsDependencies([adapter]));

    const hashes = adapter.receivedContexts.map((context) => context.requestHash);

    assert.equal(hashes.length, 3);
    assert.equal(new Set(hashes).size, 1);
  });

  it("distinguishes semantically different requests by hash", () => {
    const first = sha256Hashes.hashes({ prompt: "a" });
    const second = sha256Hashes.hashes({ prompt: "b" });

    assert.notEqual(first, second);
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
  });

  it("maps every disposition to exactly one exit code", () => {
    const codes = MODEL_EXECUTION_DISPOSITIONS.map(
      (disposition) => DISPOSITION_EXIT_CODES[disposition]
    );

    assert.equal(codes.length, MODEL_EXECUTION_DISPOSITIONS.length);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(DISPOSITION_EXIT_CODES.MODEL_RESPONSE_OBTAINED, 0);

    for (const disposition of MODEL_EXECUTION_DISPOSITIONS) {
      if (disposition !== "MODEL_RESPONSE_OBTAINED") {
        assert.ok(DISPOSITION_EXIT_CODES[disposition] > 0);
      }
    }
  });
});

describe("Conformance: every exit carries proof", () => {
  it("returns a receipt on every disposition, reached or not", async () => {
    const cases: readonly [string, unknown][] = [
      ["MODEL_REQUEST_REJECTED", { requestId: "x" }],
      [
        "PROVIDER_AUTHORITY_NOT_FOUND",
        buildsValidRequest({ providerAuthorityId: "absent" }),
      ],
      ["MODEL_ALIAS_NOT_FOUND", buildsValidRequest({ modelAlias: "absent" })],
      [
        "INTERACTION_MODE_NOT_SUPPORTED",
        buildsValidRequest({
          modelAlias: "text-only-model",
          interaction: {
            mode: "structured-generation",
            messages: [{ role: "user", content: "Classify." }],
          },
          responsePolicy: {
            format: "json",
            maximumOutputTokens: 256,
            schema: { type: "object" },
          },
        }),
      ],
    ];

    for (const [expected, request] of cases) {
      const response = await obtainsModelResponse(
        request,
        buildsDependencies([])
      );

      assert.equal(response.disposition, expected);
      assert.ok(response.proof !== undefined, `${expected} must carry proof`);
      assert.equal(typeof response.proof.startedAt, "string");
      assert.equal(typeof response.proof.completedAt, "string");
      assert.equal(response.proof.attemptCount, 0);
    }
  });

  it("honours evidence policy opt-outs", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      {
        disposition: "provider-responded",
        text: "ok",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ]);

    const request = buildsValidRequest({
      evidencePolicy: {
        captureRequestHash: false,
        captureResponseHash: false,
        captureResolvedProvider: false,
        captureResolvedModel: false,
        captureTokenUsage: false,
        captureTiming: true,
      },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "MODEL_RESPONSE_OBTAINED");
    assert.equal(response.proof.requestHash, undefined);
    assert.equal(response.proof.responseHash, undefined);
    assert.equal(response.usage, undefined);
    assert.equal(response.resolvedAuthority?.providerKind, undefined);
    assert.equal(response.resolvedAuthority?.resolvedModel, undefined);
  });
});

describe("Conformance: request validation", () => {
  it("rejects more than one authorized attempt without a continuation rule", async () => {
    const adapter = createsRecordingAdapter("invokes-gemini-model", "gemini", [
      { disposition: "provider-responded", text: "ok" },
    ]);

    const request = buildsValidRequest({
      executionPolicy: {
        timeoutMilliseconds: 60000,
        attemptAuthority: { maximumAuthorizedAttempts: 2 },
        providerSubstitution: { allowed: false },
      },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([adapter])
    );

    assert.equal(response.disposition, "MODEL_REQUEST_REJECTED");
    assert.equal(adapter.invocationCount, 0);
    assert.ok(
      response.findings?.some(
        (finding) => finding.code === "ATTEMPT_CONTINUATION_RULE_REQUIRED"
      )
    );
  });

  it("rejects a json response policy that declares no schema", async () => {
    const request = buildsValidRequest({
      responsePolicy: { format: "json", maximumOutputTokens: 256 },
    });

    const response = await obtainsModelResponse(
      request,
      buildsDependencies([])
    );

    assert.equal(response.disposition, "MODEL_REQUEST_REJECTED");
    assert.ok(
      response.findings?.some(
        (finding) => finding.code === "RESPONSE_SCHEMA_MISSING"
      )
    );
  });
});
