#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createsGeminiAdapter, fetchHttpPort } from "../providers/gemini/invokes-gemini-model.js";
import { obtainsModelResponse } from "../src/obtains-model-response/obtains-model-response.js";
import {
  DISPOSITION_EXIT_CODES,
  type ModelConnectorDependencies,
  type ProviderAuthority,
} from "../src/shared/model-connector-contract.js";
import {
  environmentCredentials,
  sha256Hashes,
  systemClock,
  uuidIdentity,
} from "../src/shared/runtime-ports.js";

/**
 * CLI front door.
 *
 * Loads declared inputs, constructs runtime ports, calls obtainsModelResponse
 * exactly once, serializes the result, and maps its disposition to an exit
 * code. It resolves no providers, invokes no SDKs, retries no calls, and
 * normalizes no responses itself.
 *
 *   stdout -> canonical model response JSON
 *   stderr -> JSONL progress and execution testimony
 *   exit   -> stable disposition code
 */

const USAGE = `llm-connector obtain \\
  --request ./demonstrations/obtains-basic-text-response.json \\
  --provider-authority ./config/provider-authority.json \\
  [--output json]`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command !== "obtain") {
    emitsProgress({ event: "cli-rejected", detail: `Unknown command "${command}".` });
    process.stderr.write(`${USAGE}\n`);
    return DISPOSITION_EXIT_CODES.MODEL_REQUEST_REJECTED;
  }

  const options = parsesOptions(rest);

  if (options.requestPath === undefined) {
    emitsProgress({ event: "cli-rejected", detail: "--request is required." });
    process.stderr.write(`${USAGE}\n`);
    return DISPOSITION_EXIT_CODES.MODEL_REQUEST_REJECTED;
  }

  if (options.providerAuthorityPath === undefined) {
    emitsProgress({
      event: "cli-rejected",
      detail: "--provider-authority is required.",
    });
    process.stderr.write(`${USAGE}\n`);
    return DISPOSITION_EXIT_CODES.PROVIDER_AUTHORITY_NOT_FOUND;
  }

  let request: unknown;
  let providerAuthorities: readonly ProviderAuthority[];

  try {
    request = await readsJsonFile(options.requestPath);
    providerAuthorities = normalizesAuthorities(
      await readsJsonFile(options.providerAuthorityPath)
    );
  } catch (error) {
    emitsProgress({
      event: "cli-input-unreadable",
      detail: error instanceof Error ? error.message : String(error),
    });
    return DISPOSITION_EXIT_CODES.MODEL_REQUEST_REJECTED;
  }

  const dependencies: ModelConnectorDependencies = {
    providerAuthorities,
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
  };

  emitsProgress({
    event: "obtain-model-response-started",
    requestPath: options.requestPath,
    providerAuthorityPath: options.providerAuthorityPath,
  });

  const response = await obtainsModelResponse(request, dependencies);

  emitsProgress({
    event: "obtain-model-response-completed",
    requestId: response.requestId,
    disposition: response.disposition,
    attemptCount: response.proof.attemptCount,
    durationMilliseconds: response.proof.durationMilliseconds,
  });

  for (const attempt of response.attempts ?? []) {
    emitsProgress({ event: "provider-attempt-testimony", ...attempt });
  }

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);

  return DISPOSITION_EXIT_CODES[response.disposition];
}

type CliOptions = Readonly<{
  requestPath?: string;
  providerAuthorityPath?: string;
  output: "json";
}>;

function parsesOptions(argv: readonly string[]): CliOptions {
  let requestPath: string | undefined;
  let providerAuthorityPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--request" && value !== undefined) {
      requestPath = value;
      index += 1;
    } else if (flag === "--provider-authority" && value !== undefined) {
      providerAuthorityPath = value;
      index += 1;
    } else if (flag === "--output" && value !== undefined) {
      index += 1;
    }
  }

  return { requestPath, providerAuthorityPath, output: "json" };
}

async function readsJsonFile(path: string): Promise<unknown> {
  const absolute = resolve(process.cwd(), path);
  const contents = await readFile(absolute, "utf8");

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `File "${absolute}" is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** A provider authority file may declare one authority or a list of them. */
function normalizesAuthorities(loaded: unknown): readonly ProviderAuthority[] {
  if (Array.isArray(loaded)) {
    return loaded as ProviderAuthority[];
  }

  if (
    typeof loaded === "object" &&
    loaded !== null &&
    Array.isArray((loaded as { providerAuthorities?: unknown }).providerAuthorities)
  ) {
    return (loaded as { providerAuthorities: ProviderAuthority[] })
      .providerAuthorities;
  }

  return [loaded as ProviderAuthority];
}

function emitsProgress(record: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`
  );
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    emitsProgress({
      event: "cli-internal-failure",
      detail: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = DISPOSITION_EXIT_CODES.INTERNAL_EXECUTION_FAILED;
  });
