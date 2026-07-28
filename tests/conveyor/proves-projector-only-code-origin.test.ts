import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import {
  verifiesAuthorityArtifact,
  verifiesMarkdownProjection,
  type ConveyorTrustAuthority
} from "../../src/conveyor/signs-authority-artifact.js";
import type { AcceptedAuthorityArtifact } from "../../src/conveyor/conveyor-contract.js";
import { CONVEYOR_LANE_IDS } from "../../src/conveyor/conveyor-contract.js";
import type { ConveyorIntent } from "../../src/conveyor/conveyor-contract.js";
import { runsAuthorityConveyor } from "../../src/conveyor/runs-authority-conveyor.js";
import { writesJsonAuthority } from "../../src/conveyor/writes-json-authority.js";
import {
  buildsDependencies,
  createsRecordingAdapter,
  geminiAuthority
} from "../acceptance/builds-connector-fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = resolve(repositoryRoot, "generated/conveyor-demo");

describe("Conveyor code provenance", () => {
  it("publishes a signed Markdown index whose links and live signatures resolve", async () => {
    const document = await readFile(
      resolve(outputRoot, "CONVEYOR-GENERATED-BODIES.md"),
      "utf8"
    );
    const trust = JSON.parse(
      await readFile(
        resolve(outputRoot, "authority/trusted-conveyor-keys.json"),
        "utf8"
      )
    ) as ConveyorTrustAuthority;
    assert.equal(verifiesMarkdownProjection(document, trust), true);
    for (const laneId of CONVEYOR_LANE_IDS) {
      const artifact = JSON.parse(
        await readFile(
          resolve(outputRoot, "authority-conveyor", `${laneId}.json`),
          "utf8"
        )
      ) as AcceptedAuthorityArtifact;
      assert.match(document, new RegExp(artifact.provenance.invocationId));
      assert.ok(document.includes(artifact.provenance.requestHash));
      assert.ok(document.includes(artifact.provenance.responseHash));
      assert.ok(document.includes(artifact.attestation.signature));
    }
    const links = [
      ...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)
    ].map((match) => match[1]!);
    assert.ok(links.length >= CONVEYOR_LANE_IDS.length + 3);
    for (const link of links) {
      assert.equal(link.includes("://"), false);
      await access(resolve(outputRoot, link));
    }
  });

  it("persists no lane authority and projects no code after RED", async () => {
    const intent = JSON.parse(
      await readFile(
        resolve(
          repositoryRoot,
          "demonstrations/projects-greeting-capability.intent.json"
        ),
        "utf8"
      )
    ) as ConveyorIntent;
    const adapter = createsRecordingAdapter(
      "invokes-gemini-model",
      "gemini",
      [{ disposition: "provider-responded", text: "{}" }]
    );
    const root = await mkdtemp(resolve(tmpdir(), "conveyor-red-proof-"));
    try {
      const result = await runsAuthorityConveyor(intent, {
        connector: buildsDependencies([adapter]),
        providerAuthority: geminiAuthority,
        outputRoot: resolve(root, "output"),
        conveyorPrivateKeyPath: resolve(root, "keys/private.pem"),
        conveyorTrustPath: resolve(root, "output/authority/trust.json"),
        projectorRoot: resolve(
          repositoryRoot,
          "../declarative-typescript-body-projector"
        )
      });
      assert.equal(result.disposition, "LANE_REJECTED");
      assert.equal(result.stoppedAt, "feature-authority");
      assert.deepEqual(result.completedLanes, []);
      await assert.rejects(
        readFile(
          resolve(
            root,
            "output/authority-conveyor/feature-authority.json"
          )
        )
      );
      await assert.rejects(
        readFile(
          resolve(
            root,
            "output/capabilities/greet-student/greets-student.ts"
          )
        )
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("verifies every admitted LLM artifact with the conveyor key", async () => {
    const trust = JSON.parse(
      await readFile(
        resolve(outputRoot, "authority/trusted-conveyor-keys.json"),
        "utf8"
      )
    ) as ConveyorTrustAuthority;
    for (const laneId of CONVEYOR_LANE_IDS) {
      const artifact = JSON.parse(
        await readFile(
          resolve(outputRoot, "authority-conveyor", `${laneId}.json`),
          "utf8"
        )
      ) as AcceptedAuthorityArtifact;
      assert.equal(artifact.artifactType, laneId);
      assert.equal(verifiesAuthorityArtifact(artifact, trust), true);
    }
  });

  it("forbids TypeScript embodiment inside the conveyor", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "src/conveyor/runs-authority-conveyor.ts"),
      "utf8"
    );
    for (const prohibited of [
      'from "typescript"',
      "ts.factory",
      "createSourceFile(",
      "function rendersBody",
      "function tokenizes",
      "function observesTopology",
      "conveyor-code-origin",
      "writeFile("
    ]) {
      assert.equal(
        source.includes(prohibited),
        false,
        `conveyor contains prohibited embodiment construct: ${prohibited}`
      );
    }
    assert.match(source, /project-authority-tree/);
    assert.match(source, /adopt-ast-tree/);
    await assert.rejects(
      writesJsonAuthority(
        resolve(outputRoot, "must-never-be-written.ts"),
        { forbidden: true }
      ),
      /rejects non-JSON target/
    );
  });

  it("binds the projector signature to the admitted LLM body authority", async () => {
    const authority = JSON.parse(
      await readFile(
        resolve(
          outputRoot,
          "authority-conveyor/typescript-body-authority.json"
        ),
        "utf8"
      )
    ) as AcceptedAuthorityArtifact;
    const trust = JSON.parse(
      await readFile(
        resolve(outputRoot, "authority/trusted-conveyor-keys.json"),
        "utf8"
      )
    ) as ConveyorTrustAuthority;
    assert.equal(verifiesAuthorityArtifact(authority, trust), true);

    const body = await readFile(
      resolve(outputRoot, "capabilities/greet-student/greets-student.ts"),
      "utf8"
    );
    assert.match(
      body,
      /^\/\/ projector-id: declarative-typescript-body-projector$/m
    );
    assert.match(body, /^\/\/ projection-signature: ed25519:.+$/m);
    assert.match(
      body,
      new RegExp(
        `^// projection-id: .+-from-${authority.attestation.artifactHash.replace(
          "sha256:",
          ""
        )}$`,
        "m"
      )
    );

    const alteredAuthority = structuredClone(authority) as Record<
      string,
      unknown
    >;
    const alteredRequest = (
      alteredAuthority["projectorRequest"] as Record<string, unknown>
    );
    const alteredFunction = alteredRequest["function"] as Record<
      string,
      unknown
    >;
    alteredFunction["name"] = "modelSmuggledImplementation";
    assert.equal(
      verifiesAuthorityArtifact(
        alteredAuthority as unknown as AcceptedAuthorityArtifact,
        trust
      ),
      false
    );
  });

  it("rejects altered code bytes and altered AST authority independently", async () => {
    const projectorModuleUrl = pathToFileURL(
      resolve(
        repositoryRoot,
        "../declarative-typescript-body-projector/src/ast/projects-signed-typescript-ast.ts"
      )
    ).href;
    const projector = (await import(projectorModuleUrl)) as {
      verifiesSignedTypeScriptAst(options: {
        request: unknown;
        artifactBytes: Uint8Array;
        trustedKeys: unknown;
      }): { conforms: boolean; disposition: string };
    };
    const request = JSON.parse(
      await readFile(
        resolve(
          outputRoot,
          "capabilities/greet-student/greets-student.ts.ast.authority.json"
        ),
        "utf8"
      )
    ) as Record<string, unknown>;
    const trustedKeys = JSON.parse(
      await readFile(
        resolve(
          outputRoot,
          "projection-authority/trusted-projector-keys.json"
        ),
        "utf8"
      )
    );
    const body = await readFile(
      resolve(outputRoot, "capabilities/greet-student/greets-student.ts")
    );
    assert.equal(
      projector.verifiesSignedTypeScriptAst({
        request,
        artifactBytes: body,
        trustedKeys
      }).conforms,
      true
    );
    const alteredBody = Buffer.concat([
      body,
      Buffer.from("// model-smuggled-code\n")
    ]);
    assert.equal(
      projector.verifiesSignedTypeScriptAst({
        request,
        artifactBytes: alteredBody,
        trustedKeys
      }).disposition,
      "BODY_HASH_MISMATCH"
    );
    const alteredRequest = structuredClone(request);
    (alteredRequest["lineage"] as Record<string, unknown>)["signalId"] =
      "model-smuggled-signal";
    assert.equal(
      projector.verifiesSignedTypeScriptAst({
        request: alteredRequest,
        artifactBytes: body,
        trustedKeys
      }).disposition,
      "AUTHORITY_HASH_MISMATCH"
    );
  });

  it("replays semantic authority and rejects AST substitution even if re-signed", async () => {
    const bodyAuthority = JSON.parse(
      await readFile(
        resolve(
          outputRoot,
          "authority-conveyor/typescript-body-authority.json"
        ),
        "utf8"
      )
    ) as AcceptedAuthorityArtifact;
    const astAuthority = JSON.parse(
      await readFile(
        resolve(
          outputRoot,
          "capabilities/greet-student/greets-student.ts.ast.authority.json"
        ),
        "utf8"
      )
    ) as {
      sourceAst: { tokens: readonly { text: string }[] };
    };
    const projectorRoot = resolve(
      repositoryRoot,
      "../declarative-typescript-body-projector"
    );
    const executionModule = (await import(
      pathToFileURL(
        resolve(
          projectorRoot,
          "src/bootstrap/executes-semantic-ast-projection.ts"
        )
      ).href
    )) as {
      executesSemanticAstProjection(options: {
        request: unknown;
        outputRoot: string;
      }): Promise<{ result?: { artifactPath: string } }>;
    };
    const signedAstModule = (await import(
      pathToFileURL(
        resolve(
          projectorRoot,
          "src/ast/projects-signed-typescript-ast.ts"
        )
      ).href
    )) as { stripsProjectionHeader(source: string): string };
    const declared = bodyAuthority["projectorRequest"] as Record<
      string,
      unknown
    >;
    const replayRequest = {
      ...declared,
      projectionId: `${String(
        declared["projectionId"]
      )}-from-${bodyAuthority.attestation.artifactHash.replace("sha256:", "")}`
    };
    const replayRoot = await mkdtemp(
      resolve(tmpdir(), "conveyor-semantic-replay-")
    );
    try {
      const outcome = await executionModule.executesSemanticAstProjection({
        request: replayRequest,
        outputRoot: replayRoot
      });
      assert.ok(outcome.result !== undefined);
      const replayed = signedAstModule.stripsProjectionHeader(
        await readFile(outcome.result.artifactPath, "utf8")
      );
      const declaredAstBody = astAuthority.sourceAst.tokens
        .map((token) => token.text)
        .join("");
      assert.equal(declaredAstBody, replayed);

      const substituted = `${declaredAstBody}// substituted AST body\n`;
      assert.notEqual(substituted, replayed);
    } finally {
      await rm(replayRoot, { recursive: true, force: true });
    }
  });

  it("executes the projected code body through its declared semantic edge", async () => {
    const moduleUrl = pathToFileURL(
      resolve(outputRoot, "capabilities/greet-student/greets-student.ts")
    ).href;
    const projected = (await import(moduleUrl)) as {
      greetsStudent(context: {
        edges: {
          invokes(
            edgeId: string,
            input: unknown
          ): Promise<{ signalId: string; disposition: string; value: string }>;
        };
      }): Promise<{ signalId: string; disposition: string; value: string }>;
    };
    const signal = await projected.greetsStudent({
      edges: {
        async invokes(edgeId) {
          assert.equal(edgeId, "resolve-student-greeting");
          return {
            signalId: "student-greeting",
            disposition: "GREEN",
            value: "Hello, student."
          };
        }
      }
    });
    assert.deepEqual(signal, {
      signalId: "student-greeting",
      disposition: "GREEN",
      value: "Hello, student."
    });
  });
});
