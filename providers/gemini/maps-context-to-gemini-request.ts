import type { ModelInvocationContext } from "../../src/shared/model-connector-contract.js";

/**
 * Gemini wire shapes. These types exist only inside this adapter; nothing
 * here may be exported past the provider boundary.
 */
export type GeminiRequestBody = Readonly<{
  contents: readonly {
    role: "user" | "model";
    parts: readonly { text: string }[];
  }[];
  systemInstruction?: { parts: readonly { text: string }[] };
  generationConfig: {
    maxOutputTokens: number;
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
}>;

export const GEMINI_DEFAULT_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta";

/**
 * Translates the sealed invocation context into the Gemini generateContent
 * request body.
 *
 * Gemini has no first-class system role: system messages become a dedicated
 * systemInstruction, and assistant messages map to the "model" role.
 */
export function mapsContextToGeminiRequest(
  context: ModelInvocationContext
): GeminiRequestBody {
  const systemTexts = context.interaction.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);

  const contents = context.interaction.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: message.content }],
    }));

  const generationConfig: GeminiRequestBody["generationConfig"] = {
    maxOutputTokens: context.responsePolicy.maximumOutputTokens,
  };

  if (context.responsePolicy.temperature !== undefined) {
    generationConfig.temperature = context.responsePolicy.temperature;
  }

  if (context.responsePolicy.format === "json") {
    generationConfig.responseMimeType = "application/json";

    if (context.responsePolicy.schema !== undefined) {
      generationConfig.responseSchema = toGeminiSchema(
        context.responsePolicy.schema
      );
    }
  }

  return Object.freeze({
    contents,
    systemInstruction:
      systemTexts.length > 0
        ? { parts: systemTexts.map((text) => ({ text })) }
        : undefined,
    generationConfig,
  });
}

export function buildsGeminiEndpointUrl(
  context: ModelInvocationContext
): string {
  const base = (context.provider.endpoint ?? GEMINI_DEFAULT_ENDPOINT).replace(
    /\/+$/,
    ""
  );

  return `${base}/models/${encodeURIComponent(context.model.resolvedName)}:generateContent`;
}

/**
 * Gemini accepts a JSON-Schema subset and rejects unknown keywords such as
 * $schema and additionalProperties.
 */
function toGeminiSchema(
  schema: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const allowed = new Set([
    "type",
    "format",
    "description",
    "nullable",
    "enum",
    "items",
    "properties",
    "required",
  ]);

  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) {
      continue;
    }

    if (key === "properties" && isRecord(value)) {
      const properties: Record<string, unknown> = {};

      for (const [propertyKey, propertyValue] of Object.entries(value)) {
        properties[propertyKey] = isRecord(propertyValue)
          ? toGeminiSchema(propertyValue)
          : propertyValue;
      }

      mapped[key] = properties;
      continue;
    }

    if (key === "items" && isRecord(value)) {
      mapped[key] = toGeminiSchema(value);
      continue;
    }

    mapped[key] = value;
  }

  return mapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
