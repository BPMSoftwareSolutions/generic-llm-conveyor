# Capability context

```text
┌──────────────────────── SOFTWARE SYSTEM ────────────────────────┐
│ Cognitive Harness                                               │
│                                                                 │
│ Understands intent, prepares requests, selects capabilities,    │
│ and consumes normalized model testimony.                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ invokes
                               ▼
┌────────────────────────── CONTAINER ────────────────────────────┐
│ Generic LLM Connector                                           │
│                                                                 │
│ Provider-neutral request validation, authority resolution,      │
│ invocation coordination, normalization, and proof.              │
└───────────────┬──────────────────┬──────────────────┬───────────┘
                │ delegates        │ delegates        │ delegates
                ▼                  ▼                  ▼
       ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
       │ Gemini Adapter │ │ OpenAI Adapter │ │ Llama Adapter  │
       │   [v0.1]       │ │   [deferred]   │ │   [deferred]   │
       │ Protocol only  │ │ Protocol only  │ │ Protocol only  │
       └───────┬────────┘ └───────┬────────┘ └───────┬────────┘
               │                  │                  │
               ▼                  ▼                  ▼
          Gemini API         OpenAI API        llama.cpp host
```

The provider adapters own transport and protocol translation.
The connector owns the meaning of the operation.

## Internal component model

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
