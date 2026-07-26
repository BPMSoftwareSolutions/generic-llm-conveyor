# Proof flow

```text
ModelRequest
     │
     │  canonical request facts
     │  (requestId, authority, alias, interaction, responsePolicy)
     │  — excludes evidencePolicy and attemptNumber, so the same
     │    semantic request hashes identically however it is observed
     ▼
sha256 over canonical JSON (sorted keys)
     │
     ▼
requestHash ──────────────────┐
                              │
Provider invocation           │
     │                        │
     ▼                        │
ProviderInvocationTestimony   │
     │                        │
     ├── observation ─────────┼──▶ startedAt, completedAt, durationMs
     ├── usage ───────────────┼──▶ inputTokens, outputTokens, totalTokens
     └── providerFailure ─────┼──▶ providerCode, providerMessage
                              │
     ▼                        │
normalizeModelResponse        │
     │                        │
     ├── satisfied ───────────┼──▶ hash the normalized result
     └── not satisfied ───────┼──▶ hash the raw provider response
            │                 │     (the invalid payload itself is never
            │                 │      echoed into the receipt)
            ▼                 │
       responseHash ──────────┤
                              │
                              ▼
                    ModelExecutionReceipt
                    ├── requestHash
                    ├── responseHash
                    ├── attemptCount
                    ├── startedAt
                    ├── completedAt
                    └── durationMilliseconds
```

## Every exit carries proof

```text
MODEL_REQUEST_REJECTED          ──▶ receipt, attemptCount 0, no hashes
PROVIDER_AUTHORITY_NOT_FOUND    ──▶ receipt, attemptCount 0, no hashes
MODEL_ALIAS_NOT_FOUND           ──▶ receipt, attemptCount 0, no hashes
INTERACTION_MODE_NOT_SUPPORTED  ──▶ receipt, attemptCount 0, no hashes
PROVIDER_*                      ──▶ receipt, attemptCount ≥ 1, requestHash
RESPONSE_FORMAT_NOT_SATISFIED   ──▶ receipt, both hashes, no result
ATTEMPT_AUTHORITY_EXHAUSTED     ──▶ receipt, attemptCount == authorized
MODEL_RESPONSE_OBTAINED         ──▶ receipt, both hashes, result
```

## Evidence policy governs capture, not production

An evidence policy flag set to `false` omits that fact from the receipt. It
does not change what the connector did — only what it attests to.
