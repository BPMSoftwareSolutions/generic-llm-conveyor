import type {
  ModelInvocationContext,
  ProviderInvocationTestimony,
  ResponseFormat,
} from "../shared/model-connector-contract.js";

export type NormalizedModelResult =
  | Readonly<{
      satisfied: true;
      result: Readonly<{
        format: ResponseFormat;
        text?: string;
        structuredValue?: unknown;
        finishReason?: string;
      }>;
    }>
  | Readonly<{ satisfied: false; detail: string }>;

/**
 * Converts protocol output into the canonical response shape and confirms it
 * satisfies the declared response policy.
 *
 * This is not domain validation — it establishes only that the declared
 * format was actually produced. Interpreting the content is the harness's job.
 */
export function normalizesModelResponse(
  context: ModelInvocationContext,
  testimony: ProviderInvocationTestimony
): NormalizedModelResult {
  const format = context.responsePolicy.format;
  const response = testimony.response;

  if (response === undefined) {
    return {
      satisfied: false,
      detail: "The provider responded without any response payload.",
    };
  }

  if (format === "text") {
    if (typeof response.text !== "string" || response.text.length === 0) {
      return {
        satisfied: false,
        detail: 'A "text" response policy requires non-empty response text.',
      };
    }

    return {
      satisfied: true,
      result: Object.freeze({
        format,
        text: response.text,
        finishReason: response.finishReason,
      }),
    };
  }

  const structured = extractsStructuredValue(response);

  if (!structured.parsed) {
    return { satisfied: false, detail: structured.detail };
  }

  const schemaFinding = violatesDeclaredSchema(
    structured.value,
    context.responsePolicy.schema
  );

  if (schemaFinding !== undefined) {
    return { satisfied: false, detail: schemaFinding };
  }

  return {
    satisfied: true,
    result: Object.freeze({
      format,
      structuredValue: structured.value,
      finishReason: response.finishReason,
    }),
  };
}

type StructuredExtraction =
  | Readonly<{ parsed: true; value: unknown }>
  | Readonly<{ parsed: false; detail: string }>;

function extractsStructuredValue(
  response: Readonly<{ text?: string; structuredValue?: unknown }>
): StructuredExtraction {
  if (response.structuredValue !== undefined) {
    return { parsed: true, value: response.structuredValue };
  }

  if (typeof response.text !== "string" || response.text.length === 0) {
    return {
      parsed: false,
      detail: 'A "json" response policy requires a structured or text payload.',
    };
  }

  try {
    return { parsed: true, value: JSON.parse(response.text) };
  } catch {
    // The invalid payload itself is never echoed — it is represented only by
    // its evidence hash in the receipt.
    return {
      parsed: false,
      detail: "The provider response could not be parsed as JSON.",
    };
  }
}

/**
 * Structural check against the declared schema.
 *
 * Supports the subset of JSON Schema needed to prove format satisfaction:
 * type, required, and properties. Deeper contract validation belongs to the
 * consuming capability, not to the connector.
 */
function violatesDeclaredSchema(
  value: unknown,
  schema: Readonly<Record<string, unknown>> | undefined
): string | undefined {
  if (schema === undefined) {
    return undefined;
  }

  return checksAgainstSchema(value, schema, "/");
}

function checksAgainstSchema(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  pointer: string
): string | undefined {
  const declaredType = schema.type;

  if (typeof declaredType === "string") {
    if (!matchesJsonType(value, declaredType)) {
      return `Value at "${pointer}" does not satisfy declared type "${declaredType}".`;
    }
  }

  if (declaredType === "object" || isRecord(schema.properties)) {
    if (!isRecord(value)) {
      return `Value at "${pointer}" does not satisfy declared type "object".`;
    }

    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const key of required) {
      if (typeof key === "string" && !(key in value)) {
        return `Required property "${key}" is missing at "${pointer}".`;
      }
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value) || !isRecord(propertySchema)) {
        continue;
      }

      const nested = checksAgainstSchema(
        value[key],
        propertySchema,
        pointer === "/" ? `/${key}` : `${pointer}/${key}`
      );

      if (nested !== undefined) {
        return nested;
      }
    }
  }

  if (declaredType === "array" && isRecord(schema.items) && Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = checksAgainstSchema(
        value[index],
        schema.items,
        `${pointer === "/" ? "" : pointer}/${index}`
      );

      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

function matchesJsonType(value: unknown, declaredType: string): boolean {
  switch (declaredType) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
