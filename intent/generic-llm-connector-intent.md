# Generic LLM Connector — Intent

## Canonical capability intent

> **Obtain one normalized model response under an explicitly resolved provider,
> model, request, execution policy, and evidence policy.**

Canonical operation:

```text
obtainsModelResponse(request, executionPolicy)
```

Canonical capability ID:

```text
obtains-model-response
```

The connector does not "chat with AI", "run intelligence", or "manage prompts".
It obtains a model response under declared authority.

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

That keeps it a micro-capability rather than allowing it to grow into an AI
framework. The surrounding cognitive harness is responsible for understanding
intent and selecting capabilities. The connector simply gives that harness a
consistent, proven way to engage a model provider.

## Governing doctrines

**Declared authority only.** A provider is used because a request named it. An
alias resolves because an authority mapped it. Nothing is defaulted, guessed,
or inferred.

**Sealed edge.** Every resolved input is frozen into one `ModelInvocationContext`
before the provider boundary is crossed. Adapters receive that context and
nothing else, which keeps DTO stitching out of the execution path.

**One attempt, one invocation, one testimony.** Repeating an attempt requires a
declared continuation rule. Substituting a provider requires declared
substitution authority. Neither ever happens implicitly.

**Provider errors are testimony; dispositions are decisions.** `HTTP 429`,
`RESOURCE_EXHAUSTED`, and `rate_limit_exceeded` all normalize to
`PROVIDER_UNAVAILABLE`, with the original preserved as observed testimony.
Downstream consumers decide on the canonical disposition.

**Every exit carries proof.** There is no path out of the capability that
returns a result without a receipt — including paths that never reached a
provider.

## Scope of v0.1

```text
Provider          Gemini
Interaction       text-generation, structured-generation
Response formats  text, JSON constrained by a declared schema
Execution         declared attempts, explicit timeout, no fallback
Evidence          request hash, response hash, provider authority,
                  resolved model, timing, usage when available,
                  stable disposition
```

OpenAI, Anthropic, LiteLLM, and llama.cpp adapters are deliberately deferred.
They arrive by passing the same adapter conformance suite, not by changing the
connector.

## Acceptance authority

Behaviour is governed by [`acceptance/obtains-model-response.feature`](../acceptance/obtains-model-response.feature).
Each scenario there maps 1:1 to a `describe` block in
[`tests/acceptance/obtains-model-response.steps.test.ts`](../tests/acceptance/obtains-model-response.steps.test.ts).
