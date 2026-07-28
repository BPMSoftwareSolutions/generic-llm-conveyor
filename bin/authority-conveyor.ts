#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createsGeminiAdapter, fetchHttpPort } from "../providers/gemini/invokes-gemini-model.js";
import { runsAuthorityConveyor } from "../src/conveyor/runs-authority-conveyor.js";
import type { ConveyorIntent } from "../src/conveyor/conveyor-contract.js";
import type { ProviderAuthority } from "../src/shared/model-connector-contract.js";
import {
  environmentCredentials,
  sha256Hashes,
  systemClock,
  uuidIdentity
} from "../src/shared/runtime-ports.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const intentPath = option("--intent");
const providerPath = option("--provider-authority");
const outputRoot = resolve(option("--output-root") ?? "generated/conveyor-demo");
const projectorRoot = resolve(
  option("--projector-root") ?? "../declarative-typescript-body-projector"
);
const resumeAcceptedArtifacts = process.argv.includes("--resume");

if (intentPath === undefined || providerPath === undefined) {
  throw new Error(
    "Usage: authority-conveyor --intent <json> --provider-authority <json> " +
      "[--output-root <directory>] [--projector-root <directory>]"
  );
}

const intent = JSON.parse(
  await readFile(resolve(intentPath), "utf8")
) as ConveyorIntent;
const providerAuthority = JSON.parse(
  await readFile(resolve(providerPath), "utf8")
) as ProviderAuthority;
const connector = {
  providerAuthorities: [providerAuthority],
  providerAdapters: [
    createsGeminiAdapter({
      http: fetchHttpPort,
      credentials: environmentCredentials,
      clock: systemClock
    })
  ],
  clock: systemClock,
  hashes: sha256Hashes,
  identity: uuidIdentity
};

const result = await runsAuthorityConveyor(intent, {
  connector,
  providerAuthority,
  outputRoot,
  conveyorPrivateKeyPath: resolve(
    ".conveyor-keys",
    "canonical-authority-conveyor-private.pem"
  ),
  conveyorTrustPath: resolve(
    outputRoot,
    "authority",
    "trusted-conveyor-keys.json"
  ),
  projectorRoot,
  resumeAcceptedArtifacts
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.disposition === "CONVEYOR_COMPLETED" ? 0 : 1;
