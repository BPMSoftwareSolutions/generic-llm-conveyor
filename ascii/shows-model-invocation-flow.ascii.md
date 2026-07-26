# Model invocation flow

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
     ├── mode unsupported ──────▶ INTERACTION_MODE_NOT_SUPPORTED
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
     │                                     │
     │                                     ├── transient + attempts remain
     │                                     │     └──▶ next authorized attempt
     │                                     │
     │                                     └── otherwise ──▶ PROVIDER_UNAVAILABLE
     │                                                       PROVIDER_TIMED_OUT
     │                                                       PROVIDER_REQUEST_REJECTED
     │                                                       PROVIDER_AUTHENTICATION_FAILED
     │                                                       ATTEMPT_AUTHORITY_EXHAUSTED
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

## Attempt authority

```text
No hidden retries

One authorized attempt
    ↓
One adapter invocation
    ↓
One recorded testimony
```

A second attempt is consumed only when **both** hold:

```text
continuationRule == "continue-while-provider-reports-transient-failure"
AND provider disposition ∈ { provider-unavailable, provider-timed-out }
```

A non-transient failure — authentication, request rejection — stops
immediately, even when attempts remain authorized. Spending them would be a
hidden retry against a condition that cannot resolve itself.

## Provider substitution

Forbidden:

```text
Gemini failed
   ↓
Secretly try OpenAI
```

Permitted only under declared substitution authority, and even then each
provider invocation receives its own attempt testimony.
