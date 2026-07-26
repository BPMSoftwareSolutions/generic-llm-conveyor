# Generic LLM Connector — Capability Definition v0.1

Yes—this is the correct first cognitive micro-capability.

The connector becomes the narrow, deterministic boundary between a governed harness and an external model provider. It fits the capability lifecycle already established:

```text
Intent
  ↓
Semantic authority
  ↓
Executable capability
  ↓
Observed execution
  ↓
Proof
```

The productivity measure is not how much connector code we generate. It is how quickly we can move from intent to a clearly bounded, testable, proven capability. 

---

## 1. Canonical capability intent

> **Obtain one normalized model response under an explicitly resolved provider, model, request, execution policy, and evidence policy.**

Canonical operation:

```text
obtainsModelResponse(request, executionPolicy)
```

Canonical capability ID:

```text
obtains-model-response
```

This language is important. The connector does not “chat with AI,” “run intelligence,” or “manage prompts.”

It obtains a model response under declared authority.

---

# 2. Capability boundary

## The connector owns

```text
Generic LLM Connector
├── validates the provider-neutral request
├── resolves declared provider authority
├── resolves a model alias to a concrete model
├── validates the requested interaction mode
├── constructs one immutable invocation context
├── delegates protocol mechanics to one provider adapter
├── records each authorized provider attempt
├── normalizes the provider response
├── classifies deterministic failures
└── returns result testimony and an execution receipt
```

## The connector does not own

```text
Prompt authoring
Business reasoning
Capability selection
Agent planning
Conversation memory
Semantic retrieval
Tool selection
File-system operations
Provider credential storage
Silent model substitution
Implicit fallback
Hidden retry loops
Response interpretation
Domain-specific output validation
```

That keeps it a micro-capability rather than allowing it to grow into an AI framework.

The surrounding cognitive harness is responsible for understanding intent and selecting capabilities. The connector simply gives that harness a consistent, proven way to engage a model provider. 

---

# 3. C4 boundary

```text
┌──────────────────────── SOFTWARE SYSTEM ────────────────────────┐
│ Cognitive Harness                                               │
│                                                                 │
│ Understands intent, prepares requests, selects capabilities,     │
│ and consumes normalized model testimony.                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ invokes
                               ▼
┌────────────────────────── CONTAINER ─────────────────────────────┐
│ Generic LLM Connector                                           │
│                                                                 │
│ Provider-neutral request validation, authority resolution,       │
│ invocation coordination, normalization, and proof.              │
└───────────────┬──────────────────┬──────────────────┬────────────┘
                │ delegates        │ delegates        │ delegates
                ▼                  ▼                  ▼
       ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
       │ Gemini Adapter │ │ OpenAI Adapter │ │ Llama Adapter  │
       │                │ │                │ │                │
       │ Protocol only  │ │ Protocol only  │ │ Protocol only  │
       └───────┬────────┘ └───────┬────────┘ └───────┬────────┘
               │                  │                  │
               ▼                  ▼                  ▼
          Gemini API         OpenAI API        llama.cpp host
```

The provider adapters own transport and protocol translation.

The connector owns the meaning of the operation.

---

# 4. Internal component model

```text
Generic LLM Connector
│
├── resolves-provider-authority
│     └── chooses the declared provider configuration
│
├── validates-model-request
│     └── rejects malformed or unsupported requests
│
├── resolves-model-alias
│     └── maps a semantic alias to a concrete provider model
│
├── prepares-model-invocation
│     └── creates one immutable invocation context
│
├── invokes-provider-adapter
│     └── performs exactly one invocation per authorized attempt
│
├── records-provider-testimony
│     └── captures observed provider and model facts
│
├── normalizes-model-response
│     └── converts protocol output to the canonical response
│
├── classifies-model-invocation-failure
│     └── maps provider errors into stable failure categories
│
└── returns-model-execution-receipt
      └── returns result, observations, hashes, and disposition
```

---

# 5. Canonical request contract

```json
{
  "$schema": "./schemas/model-request.schema.v1.json",
  "requestId": "explain-execution-result-001",
  "providerAuthorityId": "primary-cognitive-provider",
  "modelAlias": "instruction-capable-model",
  "interaction": {
    "mode": "text-generation",
    "messages": [
      {
        "role": "system",
        "content": "Explain only what is supported by the supplied execution evidence."
      },
      {
        "role": "user",
        "content": "Explain this execution receipt."
      }
    ]
  },
  "responsePolicy": {
    "format": "text",
    "maximumOutputTokens": 1200,
    "temperature": 0.1
  },
  "executionPolicy": {
    "timeoutMilliseconds": 60000,
    "attemptAuthority": {
      "maximumAuthorizedAttempts": 1
    },
    "providerSubstitution": {
      "allowed": false
    }
  },
  "evidencePolicy": {
    "captureRequestHash": true,
    "captureResponseHash": true,
    "captureResolvedProvider": true,
    "captureResolvedModel": true,
    "captureTokenUsage": true,
    "captureTiming": true
  }
}
```

## Important distinctions

The request declares:

* The semantic provider authority
* The semantic model alias
* The interaction
* The response constraints
* The attempt authority
* The required evidence

It does **not** contain:

* API keys
* Base URLs
* SDK-specific message objects
* Provider-specific request fields
* Hidden fallback sequences
* Runtime environment details

---

# 6. Provider authority contract

```json
{
  "$schema": "./schemas/provider-authority.schema.v1.json",
  "providerAuthorityId": "primary-cognitive-provider",
  "providerKind": "gemini",
  "adapterId": "invokes-gemini-model",
  "credentialReference": {
    "source": "environment",
    "name": "GEMINI_API_KEY"
  },
  "endpointAuthority": {
    "mode": "provider-default"
  },
  "modelAliases": {
    "instruction-capable-model": {
      "resolvedModel": "gemini-flash-latest",
      "supportedInteractionModes": [
        "text-generation",
        "structured-generation"
      ]
    }
  },
  "capabilities": {
    "supportsUsageReporting": true,
    "supportsStructuredOutput": true,
    "supportsStreaming": false
  }
}
```

The alias is semantic:

```text
instruction-capable-model
```

The concrete model is environmental/provider authority:

```text
gemini-flash-latest
```

A capability request should not have to change because a provider model version changes.

---

# 7. Immutable invocation context

All resolved inputs should be sealed into one context before crossing the provider boundary.

```ts
export type ModelInvocationContext = Readonly<{
  invocationId: string;
  requestId: string;

  provider: Readonly<{
    authorityId: string;
    kind: ProviderKind;
    adapterId: string;
    endpoint?: string;
  }>;

  model: Readonly<{
    alias: string;
    resolvedName: string;
  }>;

  interaction: Readonly<{
    mode: InteractionMode;
    messages: readonly ModelMessage[];
  }>;

  responsePolicy: Readonly<{
    format: ResponseFormat;
    maximumOutputTokens: number;
    temperature?: number;
  }>;

  executionPolicy: Readonly<{
    timeoutMilliseconds: number;
    attemptNumber: number;
    maximumAuthorizedAttempts: number;
  }>;

  evidencePolicy: EvidencePolicy;

  requestHash: string;
}>;
```

The adapter receives this:

```ts
invokesProviderModel(context)
```

Not this:

```ts
invokesProviderModel(
  provider,
  model,
  messages,
  temperature,
  timeout,
  attempt,
  evidencePolicy,
  requestHash
);
```

That preserves the sealed-edge doctrine and prevents DTO stitching across the execution path.

---

# 8. Provider adapter contract

```ts
export interface ModelProviderAdapter {
  readonly adapterId: string;
  readonly providerKind: ProviderKind;

  invokesProviderModel(
    context: ModelInvocationContext
  ): Promise<ProviderInvocationTestimony>;
}
```

Canonical testimony:

```ts
export type ProviderInvocationTestimony = Readonly<{
  invocationId: string;
  providerKind: ProviderKind;
  resolvedModel: string;

  disposition:
    | "provider-responded"
    | "provider-rejected-request"
    | "provider-timed-out"
    | "provider-unavailable"
    | "provider-authentication-failed";

  response?: Readonly<{
    text?: string;
    structuredValue?: unknown;
    finishReason?: string;
  }>;

  usage?: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;

  observation: Readonly<{
    startedAt: string;
    completedAt: string;
    durationMilliseconds: number;
    providerRequestId?: string;
  }>;

  providerFailure?: Readonly<{
    providerCode?: string;
    providerMessage?: string;
  }>;
}>;
```

This is provider testimony—not yet the public capability result.

---

# 9. Normalized result contract

```json
{
  "$schema": "./schemas/model-response.schema.v1.json",
  "requestId": "explain-execution-result-001",
  "invocationId": "invocation-20260726-0001",
  "disposition": "model-response-obtained",
  "resolvedAuthority": {
    "providerAuthorityId": "primary-cognitive-provider",
    "providerKind": "gemini",
    "modelAlias": "instruction-capable-model",
    "resolvedModel": "gemini-flash-latest"
  },
  "result": {
    "format": "text",
    "text": "The execution completed successfully..."
  },
  "usage": {
    "inputTokens": 217,
    "outputTokens": 94,
    "totalTokens": 311
  },
  "proof": {
    "requestHash": "sha256:...",
    "responseHash": "sha256:...",
    "attemptCount": 1,
    "startedAt": "2026-07-26T08:10:00.000Z",
    "completedAt": "2026-07-26T08:10:01.240Z",
    "durationMilliseconds": 1240
  }
}
```

---

# 10. Stable execution dispositions

The connector should return a small, stable vocabulary:

```text
MODEL_RESPONSE_OBTAINED
MODEL_REQUEST_REJECTED
PROVIDER_AUTHORITY_NOT_FOUND
MODEL_ALIAS_NOT_FOUND
INTERACTION_MODE_NOT_SUPPORTED
PROVIDER_AUTHENTICATION_FAILED
PROVIDER_UNAVAILABLE
PROVIDER_TIMED_OUT
PROVIDER_REQUEST_REJECTED
RESPONSE_FORMAT_NOT_SATISFIED
ATTEMPT_AUTHORITY_EXHAUSTED
EXECUTION_CANCELLED
INTERNAL_EXECUTION_FAILED
```

Provider-specific errors may appear in testimony, but downstream consumers should make decisions using the stable canonical disposition.

For example:

```text
HTTP 429
Gemini RESOURCE_EXHAUSTED
OpenAI rate_limit_exceeded
LiteLLM provider quota error
```

can normalize to:

```text
PROVIDER_UNAVAILABLE
```

with the original error preserved as observed testimony.

---

# 11. Attempt and fallback authority

This should be explicit from the beginning.

## No hidden retries

```text
One authorized attempt
    ↓
One adapter invocation
    ↓
One recorded testimony
```

## Multiple attempts require declared authority

```json
{
  "attemptAuthority": {
    "maximumAuthorizedAttempts": 3,
    "continuationRule": "continue-while-provider-reports-transient-failure"
  }
}
```

The continuation rule belongs in semantic authority, not inside an SDK adapter.

## No implicit provider fallback

This is forbidden:

```text
Gemini failed
   ↓
Secretly try OpenAI
```

This is allowed:

```json
{
  "providerSequence": [
    "primary-cognitive-provider",
    "secondary-cognitive-provider"
  ],
  "providerSubstitution": {
    "allowed": true,
    "continueWhen": [
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TIMED_OUT"
    ]
  }
}
```

Even then, each provider invocation must receive its own attempt testimony.

---

# 12. Execution flow

```text
Model Request
     │
     ▼
validateModelRequest
     │
     ├── invalid ───────────────▶ MODEL_REQUEST_REJECTED
     │
     ▼
resolveProviderAuthority
     │
     ├── unresolved ────────────▶ PROVIDER_AUTHORITY_NOT_FOUND
     │
     ▼
resolveModelAlias
     │
     ├── unresolved ────────────▶ MODEL_ALIAS_NOT_FOUND
     │
     ▼
prepareModelInvocationContext
     │
     ▼
invokeProviderAdapter exactly once
     │
     ▼
recordProviderTestimony
     │
     ├── provider failure ──────▶ classifyModelInvocationFailure
     │
     ▼
normalizeModelResponse
     │
     ├── invalid format ────────▶ RESPONSE_FORMAT_NOT_SATISFIED
     │
     ▼
produceModelExecutionReceipt
     │
     ▼
MODEL_RESPONSE_OBTAINED
```

---

# 13. Gherkin acceptance authority

```gherkin
Feature: Obtain a governed model response

  The generic LLM connector obtains a normalized model response
  under explicit provider, model, execution, and evidence authority.

  Scenario: Obtain a text response from a resolved provider
    Given a valid model request
    And the declared provider authority exists
    And the declared model alias resolves to a supported model
    And one provider attempt is authorized
    When the model response is obtained
    Then the declared provider adapter is invoked exactly once
    And the response disposition is "MODEL_RESPONSE_OBTAINED"
    And the response identifies the resolved provider
    And the response identifies the resolved model
    And the execution receipt contains the request hash
    And the execution receipt contains the response hash

  Scenario: Reject an unknown provider authority
    Given a valid model request
    And the declared provider authority does not exist
    When the model response is requested
    Then no provider adapter is invoked
    And the response disposition is "PROVIDER_AUTHORITY_NOT_FOUND"

  Scenario: Reject an unresolved model alias
    Given a valid model request
    And the declared provider authority exists
    And the declared model alias is not mapped
    When the model response is requested
    Then no provider adapter is invoked
    And the response disposition is "MODEL_ALIAS_NOT_FOUND"

  Scenario: Prevent silent provider substitution
    Given a model request authorizes only the Gemini provider
    And the Gemini provider is unavailable
    When the model response is requested
    Then the Gemini adapter is invoked exactly once
    And no other provider adapter is invoked
    And the response disposition is "PROVIDER_UNAVAILABLE"

  Scenario: Stop after the authorized attempt count
    Given a model request authorizes two attempts
    And the provider reports a transient failure for both attempts
    When the model response is requested
    Then the provider adapter is invoked exactly twice
    And two provider attempt testimonies are recorded
    And the response disposition is "ATTEMPT_AUTHORITY_EXHAUSTED"

  Scenario: Reject a response that violates the required format
    Given a model request requires a structured response
    And the provider returns text that cannot satisfy the declared schema
    When the model response is normalized
    Then the response disposition is "RESPONSE_FORMAT_NOT_SATISFIED"
    And the invalid provider response is represented only by its evidence hash
```

---

# 14. File-system body

Following the doctrine that scenario folders own their implementation and files express verbs:

```text
generic-llm-connector/
├── intent/
│   └── generic-llm-connector-intent.md
│
├── authority/
│   ├── generic-llm-connector.sej.v1.json
│   ├── provider-authority.schema.v1.json
│   ├── model-request.schema.v1.json
│   ├── model-response.schema.v1.json
│   ├── model-execution-receipt.schema.v1.json
│   └── feature-body.contract.v1.json
│
├── acceptance/
│   └── obtains-model-response.feature
│
├── ascii/
│   ├── shows-capability-context.ascii.md
│   ├── shows-model-invocation-flow.ascii.md
│   └── shows-proof-flow.ascii.md
│
├── src/
│   ├── obtains-model-response/
│   │   ├── validates-model-request.ts
│   │   ├── resolves-provider-authority.ts
│   │   ├── resolves-model-alias.ts
│   │   ├── prepares-model-invocation-context.ts
│   │   ├── invokes-provider-adapter.ts
│   │   ├── records-provider-testimony.ts
│   │   ├── normalizes-model-response.ts
│   │   ├── classifies-model-invocation-failure.ts
│   │   ├── returns-model-execution-receipt.ts
│   │   └── obtains-model-response.ts
│   │
│   ├── rejects-unknown-provider-authority/
│   │   └── rejects-unknown-provider-authority.ts
│   │
│   ├── rejects-unresolved-model-alias/
│   │   └── rejects-unresolved-model-alias.ts
│   │
│   ├── prevents-silent-provider-substitution/
│   │   └── prevents-silent-provider-substitution.ts
│   │
│   ├── stops-after-authorized-attempt-count/
│   │   └── stops-after-authorized-attempt-count.ts
│   │
│   └── rejects-invalid-response-format/
│       └── rejects-invalid-response-format.ts
│
├── providers/
│   ├── gemini/
│   │   ├── maps-context-to-gemini-request.ts
│   │   ├── invokes-gemini-model.ts
│   │   └── maps-gemini-testimony.ts
│   ├── openai/
│   │   ├── maps-context-to-openai-request.ts
│   │   ├── invokes-openai-model.ts
│   │   └── maps-openai-testimony.ts
│   ├── anthropic/
│   │   ├── maps-context-to-anthropic-request.ts
│   │   ├── invokes-anthropic-model.ts
│   │   └── maps-anthropic-testimony.ts
│   ├── litellm/
│   │   ├── maps-context-to-litellm-request.ts
│   │   ├── invokes-litellm-model.ts
│   │   └── maps-litellm-testimony.ts
│   └── llamacpp/
│       ├── maps-context-to-llamacpp-request.ts
│       ├── invokes-llamacpp-model.ts
│       └── maps-llamacpp-testimony.ts
│
├── tests/
│   ├── acceptance/
│   │   └── obtains-model-response.steps.ts
│   ├── conformance/
│   │   ├── enforces-exactly-one-adapter-invocation.ts
│   │   ├── prevents-provider-substitution.ts
│   │   ├── preserves-provider-testimony.ts
│   │   └── produces-byte-stable-failure-dispositions.ts
│   └── adapters/
│       └── verifies-provider-adapter-contract.ts
│
├── demonstrations/
│   ├── obtains-basic-text-response.json
│   ├── rejects-unknown-provider.json
│   └── records-provider-unavailability.json
│
└── package.json
```

The universal capability-package idea—authority, acceptance, ASCII, implementation, demonstrations, and proof—is already consistent with the larger deterministic-capability foundry direction. 

---

# 15. Thin orchestration body

The primary body should remain linear:

```ts
export async function obtainsModelResponse(
  request: ModelRequest,
  dependencies: ModelConnectorDependencies
): Promise<ModelResponse> {
  const validation = validatesModelRequest(request);

  if (!validation.accepted) {
    return returnsRejectedModelRequest(request, validation);
  }

  const providerAuthority = resolvesProviderAuthority(
    request.providerAuthorityId,
    dependencies.providerAuthorities
  );

  if (!providerAuthority.resolved) {
    return returnsUnresolvedProviderAuthority(request);
  }

  const modelAuthority = resolvesModelAlias(
    request.modelAlias,
    providerAuthority
  );

  if (!modelAuthority.resolved) {
    return returnsUnresolvedModelAlias(request, providerAuthority);
  }

  const context = preparesModelInvocationContext(
    request,
    providerAuthority,
    modelAuthority,
    dependencies.clock,
    dependencies.hashes
  );

  const testimony = await invokesProviderAdapter(
    context,
    dependencies.providerAdapters
  );

  const normalized = normalizesModelResponse(context, testimony);

  return returnsModelExecutionReceipt(
    context,
    testimony,
    normalized,
    dependencies.hashes
  );
}
```

No provider SDK objects should leak into this body.

No prompt decisions should appear here.

No dynamic fallback should be embedded here.

---

# 16. CLI front door

A simple initial CLI:

```bash
llm-connector obtain \
  --request ./demonstrations/obtains-basic-text-response.json \
  --provider-authority ./config/provider-authority.json \
  --output json
```

Output discipline:

```text
stdout  → canonical model response JSON
stderr  → JSONL progress and execution testimony
exit    → stable disposition code
```

Suggested exit mapping:

```text
0   MODEL_RESPONSE_OBTAINED
10  MODEL_REQUEST_REJECTED
11  PROVIDER_AUTHORITY_NOT_FOUND
12  MODEL_ALIAS_NOT_FOUND
13  INTERACTION_MODE_NOT_SUPPORTED
20  PROVIDER_AUTHENTICATION_FAILED
21  PROVIDER_UNAVAILABLE
22  PROVIDER_TIMED_OUT
23  PROVIDER_REQUEST_REJECTED
30  RESPONSE_FORMAT_NOT_SATISFIED
31  ATTEMPT_AUTHORITY_EXHAUSTED
40  EXECUTION_CANCELLED
50  INTERNAL_EXECUTION_FAILED
```

The CLI must only:

1. Load declared inputs.
2. Construct runtime ports.
3. Call `obtainsModelResponse` exactly once.
4. Serialize the returned result.
5. Map its disposition to an exit code.

It must not resolve providers, invoke SDKs, retry calls, or normalize responses itself.

---

# 17. First implementation slice

The smallest useful v0.1 should support:

```text
Provider
└── Gemini

Interaction
└── text-generation

Response formats
├── text
└── JSON constrained by a declared schema

Execution
├── one authorized attempt
├── explicit timeout
└── no fallback

Evidence
├── request hash
├── response hash
├── provider authority
├── resolved model
├── timing
├── usage when available
└── stable disposition
```

Do **not** begin by implementing every provider.

First establish:

```text
One contract
One adapter
One happy path
One unavailable-provider path
One invalid-request path
One proof receipt
```

Then make OpenAI, LiteLLM, llama.cpp, and Anthropic pass the same adapter conformance suite.

---

# 18. Definition of done for v0.1

The first slice is proven only when:

```text
✓ A provider-neutral request validates against schema
✓ A semantic model alias resolves to a concrete Gemini model
✓ The Gemini adapter is invoked exactly once
✓ Provider SDK structures remain inside the Gemini adapter
✓ A successful text response is normalized
✓ Request and response hashes are produced
✓ Provider and model observations appear in the receipt
✓ An unknown provider fails before adapter invocation
✓ An unknown model alias fails before adapter invocation
✓ Provider failure does not trigger hidden fallback
✓ Attempt count cannot exceed declared authority
✓ Replaying the same invalid input produces byte-stable findings
✓ CLI and direct library invocation use the same operation
✓ Acceptance is governed by the Gherkin scenarios
```

The resulting capability is small but foundational:

```text
Cognitive Harness
       │
       ▼
obtains-model-response
       │
       ▼
Declared provider adapter
       │
       ▼
Normalized testimony + proof
```

That gives every later deterministic harness one governed cognitive connection—without giving the model authority over the architecture itself.
