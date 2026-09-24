import type {
  InteractionMode,
  MessageRole,
  ModelRequest,
  ResponseFormat,
} from "../shared/model-connector-contract.js";

export type ValidationFinding = Readonly<{
  code: string;
  detail: string;
  pointer: string;
}>;

export type ModelRequestValidation = Readonly<{
  accepted: boolean;
  findings: readonly ValidationFinding[];
}>;

const INTERACTION_MODES: readonly InteractionMode[] = [
  "text-generation",
  "structured-generation",
];

const RESPONSE_FORMATS: readonly ResponseFormat[] = ["text", "json"];

const MESSAGE_ROLES: readonly MessageRole[] = ["system", "user", "assistant"];

/**
 * Rejects malformed or unsupported requests before any authority is resolved.
 *
 * Findings are emitted in a fixed traversal order so that replaying the same
 * invalid input produces byte-stable output.
 */
export function validatesModelRequest(
  request: unknown
): ModelRequestValidation {
  const findings: ValidationFinding[] = [];

  if (!isRecord(request)) {
    return {
      accepted: false,
      findings: [
        {
          code: "REQUEST_NOT_AN_OBJECT",
          detail: "The model request must be a JSON object.",
          pointer: "/",
        },
      ],
    };
  }

  requiresNonEmptyString(request, "requestId", "/requestId", findings);
  requiresNonEmptyString(
    request,
    "providerAuthorityId",
    "/providerAuthorityId",
    findings
  );
  requiresNonEmptyString(request, "modelAlias", "/modelAlias", findings);

  validatesInteraction(request.interaction, findings);
  validatesResponsePolicy(request.responsePolicy, findings);
  validatesExecutionPolicy(request.executionPolicy, findings);
  validatesEvidencePolicy(request.evidencePolicy, findings);

  return { accepted: findings.length === 0, findings };
}

function validatesInteraction(
  interaction: unknown,
  findings: ValidationFinding[]
): void {
  if (!isRecord(interaction)) {
    findings.push({
      code: "INTERACTION_MISSING",
      detail: "The request must declare an interaction object.",
      pointer: "/interaction",
    });
    return;
  }

  if (!INTERACTION_MODES.includes(interaction.mode as InteractionMode)) {
    findings.push({
      code: "INTERACTION_MODE_INVALID",
      detail: `Interaction mode must be one of: ${INTERACTION_MODES.join(", ")}.`,
      pointer: "/interaction/mode",
    });
  }

  const messages = interaction.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    findings.push({
      code: "INTERACTION_MESSAGES_EMPTY",
      detail: "The interaction must declare at least one message.",
      pointer: "/interaction/messages",
    });
    return;
  }

  messages.forEach((message, index) => {
    const pointer = `/interaction/messages/${index}`;

    if (!isRecord(message)) {
      findings.push({
        code: "MESSAGE_NOT_AN_OBJECT",
        detail: "Each message must be an object.",
        pointer,
      });
      return;
    }

    if (!MESSAGE_ROLES.includes(message.role as MessageRole)) {
      findings.push({
        code: "MESSAGE_ROLE_INVALID",
        detail: `Message role must be one of: ${MESSAGE_ROLES.join(", ")}.`,
        pointer: `${pointer}/role`,
      });
    }

    if (typeof message.content !== "string" || message.content.length === 0) {
      findings.push({
        code: "MESSAGE_CONTENT_EMPTY",
        detail: "Message content must be a non-empty string.",
        pointer: `${pointer}/content`,
      });
    }
  });
}

function validatesResponsePolicy(
  responsePolicy: unknown,
  findings: ValidationFinding[]
): void {
  if (!isRecord(responsePolicy)) {
    findings.push({
      code: "RESPONSE_POLICY_MISSING",
      detail: "The request must declare a response policy.",
      pointer: "/responsePolicy",
    });
    return;
  }

  if (!RESPONSE_FORMATS.includes(responsePolicy.format as ResponseFormat)) {
    findings.push({
      code: "RESPONSE_FORMAT_INVALID",
      detail: `Response format must be one of: ${RESPONSE_FORMATS.join(", ")}.`,
      pointer: "/responsePolicy/format",
    });
  }

  requiresPositiveInteger(
    responsePolicy.maximumOutputTokens,
    "/responsePolicy/maximumOutputTokens",
    "RESPONSE_MAXIMUM_OUTPUT_TOKENS_INVALID",
    findings
  );

  if (responsePolicy.temperature !== undefined) {
    const temperature = responsePolicy.temperature;

    if (
      typeof temperature !== "number" ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      findings.push({
        code: "RESPONSE_TEMPERATURE_INVALID",
        detail: "Temperature must be a finite number between 0 and 2.",
        pointer: "/responsePolicy/temperature",
      });
    }
  }

  if (responsePolicy.format === "json" && !isRecord(responsePolicy.schema)) {
    findings.push({
      code: "RESPONSE_SCHEMA_MISSING",
      detail: "A json response format must declare a response schema.",
      pointer: "/responsePolicy/schema",
    });
  }
}

function validatesExecutionPolicy(
  executionPolicy: unknown,
  findings: ValidationFinding[]
): void {
  if (!isRecord(executionPolicy)) {
    findings.push({
      code: "EXECUTION_POLICY_MISSING",
      detail: "The request must declare an execution policy.",
      pointer: "/executionPolicy",
    });
    return;
  }

  requiresPositiveInteger(
    executionPolicy.timeoutMilliseconds,
    "/executionPolicy/timeoutMilliseconds",
    "EXECUTION_TIMEOUT_INVALID",
    findings
  );

  const attemptAuthority = executionPolicy.attemptAuthority;

  if (!isRecord(attemptAuthority)) {
    findings.push({
      code: "ATTEMPT_AUTHORITY_MISSING",
      detail: "The execution policy must declare attempt authority.",
      pointer: "/executionPolicy/attemptAuthority",
    });
  } else {
    requiresPositiveInteger(
      attemptAuthority.maximumAuthorizedAttempts,
      "/executionPolicy/attemptAuthority/maximumAuthorizedAttempts",
      "ATTEMPT_AUTHORITY_INVALID",
      findings
    );

    const rule = attemptAuthority.continuationRule;

    if (
      rule !== undefined &&
      rule !== "continue-while-provider-reports-transient-failure"
    ) {
      findings.push({
        code: "ATTEMPT_CONTINUATION_RULE_INVALID",
        detail:
          'Continuation rule must be "continue-while-provider-reports-transient-failure".',
        pointer: "/executionPolicy/attemptAuthority/continuationRule",
      });
    }

    // More than one attempt is meaningless without a declared continuation
    // rule; silently looping would be a hidden retry.
    if (
      typeof attemptAuthority.maximumAuthorizedAttempts === "number" &&
      attemptAuthority.maximumAuthorizedAttempts > 1 &&
      rule === undefined
    ) {
      findings.push({
        code: "ATTEMPT_CONTINUATION_RULE_REQUIRED",
        detail:
          "Authorizing more than one attempt requires an explicit continuation rule.",
        pointer: "/executionPolicy/attemptAuthority/continuationRule",
      });
    }
  }

  const substitution = executionPolicy.providerSubstitution;

  if (!isRecord(substitution) || typeof substitution.allowed !== "boolean") {
    findings.push({
      code: "PROVIDER_SUBSTITUTION_MISSING",
      detail:
        "The execution policy must declare whether provider substitution is allowed.",
      pointer: "/executionPolicy/providerSubstitution/allowed",
    });
  } else if (substitution.allowed) {
    findings.push({
      code: "PROVIDER_SUBSTITUTION_NOT_SUPPORTED",
      detail: "Provider substitution is not supported; allowed must be false.",
      pointer: "/executionPolicy/providerSubstitution/allowed",
    });
  }
}

const EVIDENCE_FLAGS = [
  "captureRequestHash",
  "captureResponseHash",
  "captureResolvedProvider",
  "captureResolvedModel",
  "captureTokenUsage",
  "captureTiming",
] as const;

function validatesEvidencePolicy(
  evidencePolicy: unknown,
  findings: ValidationFinding[]
): void {
  if (!isRecord(evidencePolicy)) {
    findings.push({
      code: "EVIDENCE_POLICY_MISSING",
      detail: "The request must declare an evidence policy.",
      pointer: "/evidencePolicy",
    });
    return;
  }

  for (const flag of EVIDENCE_FLAGS) {
    if (typeof evidencePolicy[flag] !== "boolean") {
      findings.push({
        code: "EVIDENCE_FLAG_INVALID",
        detail: `Evidence policy flag "${flag}" must be a boolean.`,
        pointer: `/evidencePolicy/${flag}`,
      });
    }
  }
}

function requiresNonEmptyString(
  source: Record<string, unknown>,
  field: string,
  pointer: string,
  findings: ValidationFinding[]
): void {
  const value = source[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    findings.push({
      code: `${toScreamingSnakeCase(field)}_INVALID`,
      detail: `Field "${field}" must be a non-empty string.`,
      pointer,
    });
  }
}

function requiresPositiveInteger(
  value: unknown,
  pointer: string,
  code: string,
  findings: ValidationFinding[]
): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    findings.push({
      code,
      detail: "Value must be an integer greater than zero.",
      pointer,
    });
  }
}

function toScreamingSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrowing helper for callers that have already validated a request. */
export function asValidatedModelRequest(request: unknown): ModelRequest {
  return request as ModelRequest;
}
