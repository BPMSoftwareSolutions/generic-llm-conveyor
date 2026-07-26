# Generic LLM Connector

> **Obtain one normalized model response under an explicitly resolved provider,
> model, request, execution policy, and evidence policy.**

The narrow, deterministic boundary between a governed harness and an external
model provider. It does not chat with AI, run intelligence, or manage prompts —
it obtains a model response under declared authority, and proves what it did.

Capability ID: `obtains-model-response` · Version `0.1.0`

## Quick start

```bash
npm install

# Run the proven behaviour
npm test

# Obtain a response through the CLI front door
export GEMINI_API_KEY=...
npm run obtain -- \
  --request ./demonstrations/obtains-basic-text-response.json \
  --provider-authority ./config/provider-authority.json
```

Output discipline:

```text
stdout  → canonical model response JSON
stderr  → JSONL progress and execution testimony
exit    → stable disposition code
```

## Library use

The CLI and any library consumer enter through the same operation.

```ts
import {
  createsGeminiAdapter,
  environmentCredentials,
  fetchHttpPort,
  obtainsModelResponse,
  sha256Hashes,
  systemClock,
  uuidIdentity,
} from "./src/index.js";

const response = await obtainsModelResponse(request, {
  providerAuthorities: [providerAuthority],
  providerAdapters: [
    createsGeminiAdapter({
      http: fetchHttpPort,
      credentials: environmentCredentials,
      clock: systemClock,
    }),
  ],
  clock: systemClock,
  hashes: sha256Hashes,
  identity: uuidIdentity,
});

if (response.disposition === "MODEL_RESPONSE_OBTAINED") {
  console.log(response.result?.text);
}
```

## Package layout

```text
intent/          canonical intent and governing doctrines
authority/       SEJ, JSON schemas, feature-body contract
acceptance/      Gherkin acceptance authority
ascii/           context, invocation flow, proof flow
src/             connector components (one verb per file)
providers/       protocol adapters — the only place SDK/wire shapes exist
tests/           acceptance, conformance, adapter contract
demonstrations/  runnable request examples
config/          provider authority declarations
bin/             CLI front door
```

## Dispositions

Downstream consumers decide on these, never on provider-specific error codes.

| Disposition | Exit | Meaning |
| --- | --- | --- |
| `MODEL_RESPONSE_OBTAINED` | 0 | A normalized response satisfying the declared format |
| `MODEL_REQUEST_REJECTED` | 10 | The request was malformed or unsupported |
| `PROVIDER_AUTHORITY_NOT_FOUND` | 11 | No authority declared with that id |
| `MODEL_ALIAS_NOT_FOUND` | 12 | The authority does not map that alias |
| `INTERACTION_MODE_NOT_SUPPORTED` | 13 | The alias does not support that mode |
| `PROVIDER_AUTHENTICATION_FAILED` | 20 | Credential rejected or unavailable |
| `PROVIDER_UNAVAILABLE` | 21 | Quota, outage, or transport failure |
| `PROVIDER_TIMED_OUT` | 22 | Deadline exceeded |
| `PROVIDER_REQUEST_REJECTED` | 23 | Provider refused the request |
| `RESPONSE_FORMAT_NOT_SATISFIED` | 30 | Output did not satisfy the declared format |
| `ATTEMPT_AUTHORITY_EXHAUSTED` | 31 | All authorized attempts consumed transiently |
| `EXECUTION_CANCELLED` | 40 | Execution cancelled |
| `INTERNAL_EXECUTION_FAILED` | 50 | Connector fault (e.g. no adapter registered) |

`HTTP 429`, Gemini `RESOURCE_EXHAUSTED`, and OpenAI `rate_limit_exceeded` all
normalize to `PROVIDER_UNAVAILABLE`. The original survives in
`attempts[].providerFailure`.

## Guarantees

**No hidden retries.** One authorized attempt → one adapter invocation → one
recorded testimony. A second attempt requires
`continuationRule: "continue-while-provider-reports-transient-failure"` *and* a
transient provider disposition. A non-transient failure stops immediately even
when attempts remain authorized.

**No implicit fallback.** A request authorizes one provider. No adapter outside
the declared authority is ever invoked.

**Sealed edge.** Adapters receive one frozen `ModelInvocationContext` and return
one `ProviderInvocationTestimony`. Provider wire shapes never escape the adapter
— proven by a test that fails if they appear in the result.

**Credentials are referenced, never carried.** The context holds
`credentialReference.name`; only the adapter reads the value.

**Every exit carries proof.** Including paths that never reached a provider.

## Adding a provider

Deferred adapters (OpenAI, Anthropic, LiteLLM, llama.cpp) arrive by passing the
same contract, not by changing the connector:

1. Add `providers/<kind>/maps-context-to-<kind>-request.ts`,
   `invokes-<kind>-model.ts`, `maps-<kind>-testimony.ts`.
2. Register the adapter id in `authority/generic-llm-connector.sej.v1.json`.
3. Apply `verifiesProviderAdapterContract("<kind>", …)` from
   [`tests/adapters/verifies-provider-adapter-contract.test.ts`](tests/adapters/verifies-provider-adapter-contract.test.ts).

## Authority

Behaviour is governed by
[`acceptance/obtains-model-response.feature`](acceptance/obtains-model-response.feature).
Every scenario maps 1:1 to a `describe` block in the acceptance suite. Structural
invariants live in
[`authority/feature-body.contract.v1.json`](authority/feature-body.contract.v1.json)
and are enforced by the conformance suite.
