#!/usr/bin/env node
import { createsRuntimeDependencies, loadsProviderAuthorities } from "../src/shared/creates-runtime.js";
import { createsProviderServer, listensOn } from "../src/http/provider-server.js";

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--provider-authority");
  const authorityPath = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!authorityPath) throw new Error("--provider-authority is required.");
  const port = Number(process.env.LLM_PROVIDER_PORT ?? "4175");
  const host = process.env.LLM_PROVIDER_HOST ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("LLM_PROVIDER_PORT must be 1–65535.");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("The credential-bearing provider server must bind to loopback. Put authenticated ingress in front of it for remote use.");
  }
  const authorities = await loadsProviderAuthorities(authorityPath);
  const server = createsProviderServer(createsRuntimeDependencies(authorities));
  const address = await listensOn(server, host, port);
  process.stdout.write(`Generic LLM provider listening at ${address}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
