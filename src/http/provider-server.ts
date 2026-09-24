import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { obtainsModelResponse } from "../obtains-model-response/obtains-model-response.js";
import type { ModelConnectorDependencies, ModelResponse } from "../shared/model-connector-contract.js";

const MAX_BODY_BYTES = 1_048_576;

/** The HTTP edge only transports the canonical request and response. */
export function createsProviderServer(dependencies: ModelConnectorDependencies) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && path === "/health") {
        sends(response, 200, { ok: true, providerAuthorityIds: dependencies.providerAuthorities.map(item => item.providerAuthorityId) });
        return;
      }
      if (request.method !== "POST" || (path !== "/invoke" && path !== "/v1/model-responses")) {
        sends(response, 404, { error: { code: "NOT_FOUND", message: "Unknown route." } });
        return;
      }
      if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
        sends(response, 415, { error: { code: "CONTENT_TYPE", message: "Expected application/json." } });
        return;
      }
      const raw = await readsBody(request);
      let body: unknown;
      try { body = JSON.parse(raw); }
      catch { sends(response, 400, { error: { code: "INVALID_JSON", message: "Request body is not valid JSON." } }); return; }
      let input = body;
      if (path === "/invoke") {
        if (!isRecord(body) || body.handlerId !== "obtain-model-response" || !Object.hasOwn(body, "input")) {
          sends(response, 400, { error: { code: "INVALID_INVOCATION", message: "Expected handlerId obtain-model-response and input." } });
          return;
        }
        input = body.input;
      }
      const result = await obtainsModelResponse(input, dependencies);
      if (path === "/invoke") {
        if (result.disposition === "MODEL_RESPONSE_OBTAINED") {
          sends(response, 200, { output: result });
        } else {
          sends(response, statusFor(result), { error: { code: result.disposition, message: result.findings?.[0]?.detail ?? result.disposition }, output: result });
        }
      } else {
        sends(response, statusFor(result), result);
      }
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
      sends(response, tooLarge ? 413 : 500, { error: {
        code: tooLarge ? "BODY_TOO_LARGE" : "INTERNAL_EXECUTION_FAILED",
        message: tooLarge ? `JSON body exceeds ${MAX_BODY_BYTES} bytes.` : "Provider server failed to process the request.",
      } });
    }
  });
}

export async function listensOn(server: ReturnType<typeof createsProviderServer>, host: string, port: number): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  return `http://${host}:${address.port}`;
}

function statusFor(result: ModelResponse): number {
  switch (result.disposition) {
    case "MODEL_RESPONSE_OBTAINED": return 200;
    case "MODEL_REQUEST_REJECTED":
    case "PROVIDER_AUTHORITY_NOT_FOUND":
    case "MODEL_ALIAS_NOT_FOUND":
    case "INTERACTION_MODE_NOT_SUPPORTED": return 422;
    case "PROVIDER_AUTHENTICATION_FAILED": return 502;
    case "PROVIDER_TIMED_OUT": return 504;
    case "PROVIDER_UNAVAILABLE": return 503;
    default: return 502;
  }
}

async function readsBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sends(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
