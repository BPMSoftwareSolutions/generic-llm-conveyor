import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { obtainsModelResponse } from "../obtains-model-response/obtains-model-response.js";
import type { ModelRequest } from "../shared/model-connector-contract.js";
import {
  CONVEYOR_LANE_IDS,
  type AcceptedAuthorityArtifact,
  type ConveyorDependencies,
  type ConveyorIntent,
  type ConveyorLaneId,
  type ConveyorResult
} from "./conveyor-contract.js";
import {
  initializesConveyorIdentity,
  signsAuthorityArtifact,
  verifiesAuthorityArtifact
} from "./signs-authority-artifact.js";
import { writesJsonAuthority } from "./writes-json-authority.js";
import { projectsConveyorDocument } from "./projects-conveyor-document.js";

const executes = promisify(execFile);
const SEMANTIC_PROJECTOR_SCHEMA_ID =
  "https://schemas.deterministic.solutions/projection/semantic-invocation-function-request/1.0.0/schema.json";
const SEMANTIC_PROJECTOR_SCHEMA_DIGEST =
  "sha256:923b757154a0b858f9cc418d4d270993aa7e3a68b4acce81aac0f5cfab6b31bd";

type JsonSchema = Readonly<Record<string, unknown>>;

const laneFields: Readonly<Record<ConveyorLaneId, readonly string[]>> = {
  "feature-authority": ["featureId", "need", "promise"],
  "scenario-authority": [
    "featureId",
    "scenarioId",
    "given",
    "when",
    "then"
  ],
  "obligation-authority": [
    "featureId",
    "scenarioId",
    "obligationId",
    "obligation"
  ],
  "responsibility-authority": [
    "featureId",
    "scenarioId",
    "obligationId",
    "responsibilityId",
    "responsibility"
  ],
  "signal-authority": [
    "featureId",
    "scenarioId",
    "obligationId",
    "responsibilityId",
    "signalId",
    "greenMeaning",
    "redMeaning"
  ],
  "semantic-execution-authority": [
    "featureId",
    "scenarioId",
    "obligationId",
    "responsibilityId",
    "signalId",
    "semanticOperationId",
    "evaluationRule"
  ],
  "semantic-ast-authority": [
    "featureId",
    "scenarioId",
    "obligationId",
    "responsibilityId",
    "signalId",
    "semanticOperationId",
    "functionName",
    "parameterName",
    "contextType",
    "resultType",
    "semanticEdgeId"
  ],
  "typescript-body-authority": []
};

export async function runsAuthorityConveyor(
  intent: ConveyorIntent,
  dependencies: ConveyorDependencies
): Promise<ConveyorResult> {
  const trust = await initializesConveyorIdentity(
    dependencies.conveyorPrivateKeyPath,
    dependencies.conveyorTrustPath
  );
  const accepted: AcceptedAuthorityArtifact[] = [];

  for (const laneId of CONVEYOR_LANE_IDS) {
    if (dependencies.resumeAcceptedArtifacts === true) {
      const resumed = await readsAcceptedArtifact(
        dependencies.outputRoot,
        laneId
      );
      if (resumed !== undefined && verifiesAuthorityArtifact(resumed, trust)) {
        const { provenance: _provenance, attestation: _attestation, ...submission } =
          resumed;
        if (findsLaneViolation(submission, intent, laneId) === undefined) {
          accepted.push(resumed);
          continue;
        }
      }
    }
    const request = createsLaneRequest(intent, laneId, accepted);
    const response = await obtainsModelResponse(request, dependencies.connector);
    if (
      response.disposition !== "MODEL_RESPONSE_OBTAINED" ||
      response.result?.structuredValue === undefined ||
      response.proof.requestHash === undefined ||
      response.proof.responseHash === undefined ||
      response.invocationId === undefined ||
      response.resolvedAuthority?.resolvedModel === undefined
    ) {
      const providerFailure = response.attempts?.at(-1)?.providerFailure;
      return {
        disposition: "LANE_REJECTED",
        completedLanes: accepted.map((artifact) => artifact.artifactType),
        stoppedAt: laneId,
        finding: [
          `Connector disposition: ${response.disposition}`,
          providerFailure?.providerCode,
          providerFailure?.providerMessage
        ]
          .filter((value) => value !== undefined)
          .join(" — ")
      };
    }
    const candidate = response.result.structuredValue;
    const finding = findsLaneViolation(candidate, intent, laneId);
    if (finding !== undefined) {
      return {
        disposition: "LANE_REJECTED",
        completedLanes: accepted.map((artifact) => artifact.artifactType),
        stoppedAt: laneId,
        finding
      };
    }
    const signed = await signsAuthorityArtifact(
      candidate as Record<string, unknown>,
      {
        requestHash: response.proof.requestHash,
        responseHash: response.proof.responseHash,
        invocationId: response.invocationId,
        providerAuthorityId: intentProviderAuthorityId(dependencies),
        resolvedModel: response.resolvedAuthority.resolvedModel
      },
      dependencies.conveyorPrivateKeyPath,
      trust
    );
    if (!verifiesAuthorityArtifact(signed, trust)) {
      throw new Error(`Conveyor signature failed for ${laneId}`);
    }
    await writesArtifact(dependencies.outputRoot, laneId, signed);
    accepted.push(signed);
  }

  const bodyAuthority = accepted.at(-1);
  if (bodyAuthority === undefined) throw new Error("Body authority missing");
  const projected = await projectsBody(
    bodyAuthority,
    dependencies.outputRoot,
    dependencies.projectorRoot
  );
  const generatedDocumentPath = await projectsConveyorDocument({
    outputRoot: dependencies.outputRoot,
    artifacts: accepted,
    generatedBodyPath: projected.path,
    codeProvenance: projected.provenance,
    privateKeyPath: dependencies.conveyorPrivateKeyPath,
    trust
  });
  return {
    disposition: "CONVEYOR_COMPLETED",
    completedLanes: CONVEYOR_LANE_IDS,
    generatedBodyPath: projected.path,
    codeProvenance: projected.provenance,
    generatedDocumentPath
  };
}

function createsLaneRequest(
  intent: ConveyorIntent,
  laneId: ConveyorLaneId,
  accepted: readonly AcceptedAuthorityArtifact[]
): ModelRequest {
  const schema = laneSchema(laneId);
  return {
    requestId: `${intent.intentId}-${laneId}`,
    providerAuthorityId: "primary-cognitive-provider",
    modelAlias: "instruction-capable-model",
    interaction: {
      mode: "structured-generation",
      messages: [
        {
          role: "system",
          content:
            "You are one bounded authority-projection lane. Return only the declared JSON object. Preserve every supplied identity exactly. Do not add fields, prose, code, or markdown."
        },
        {
          role: "user",
          content: JSON.stringify({
            assignment: laneId,
            requiredIdentities: expectedValues(intent),
            fieldBindings:
              laneId === "typescript-body-authority"
                ? {
                    "projectorRequest.function.identity":
                      "responsibilityId",
                    "projectorRequest.function.name": "functionName",
                    "projectorRequest.function.contextParameter.name":
                      "parameterName",
                    "projectorRequest.function.contextParameter.typeReference":
                      "contextType",
                    "projectorRequest.function.resultTypeReference":
                      "resultType",
                    "projectorRequest.function.semanticEdgeId":
                      "semanticOperationId",
                    "projectorRequest.function.awaited": true
                  }
                : undefined,
            humanIntent: intent.statement,
            admittedUpstreamArtifacts: accepted
          })
        }
      ]
    },
    responsePolicy: {
      format: "json",
      maximumOutputTokens:
        laneId === "typescript-body-authority" ? 4096 : 1024,
      temperature: 0,
      schema
    },
    executionPolicy: {
      timeoutMilliseconds: 60000,
      attemptAuthority: { maximumAuthorizedAttempts: 1 },
      providerSubstitution: { allowed: false }
    },
    evidencePolicy: {
      captureRequestHash: true,
      captureResponseHash: true,
      captureResolvedProvider: true,
      captureResolvedModel: true,
      captureTokenUsage: true,
      captureTiming: true
    }
  };
}

function laneSchema(laneId: ConveyorLaneId): JsonSchema {
  if (laneId === "typescript-body-authority") {
    return bodyAuthoritySchema();
  }
  const properties: Record<string, unknown> = {
    artifactType: { type: "string", enum: [laneId] }
  };
  for (const field of laneFields[laneId]) {
    properties[field] = { type: "string" };
  }
  return {
    type: "object",
    required: ["artifactType", ...laneFields[laneId]],
    properties
  };
}

function bodyAuthoritySchema(): JsonSchema {
  const string = { type: "string" };
  return {
    type: "object",
    required: ["artifactType", "projectorRequest"],
    properties: {
      artifactType: {
        type: "string",
        enum: ["typescript-body-authority"]
      },
      projectorRequest: {
        type: "object",
        required: [
          "contract",
          "projectionId",
          "targetLanguage",
          "artifact",
          "lineage",
          "function"
        ],
        properties: {
          contract: {
            type: "object",
            required: ["schemaId", "schemaVersion", "schemaDigest"],
            properties: {
              schemaId: {
                type: "string",
                enum: [SEMANTIC_PROJECTOR_SCHEMA_ID]
              },
              schemaVersion: { type: "string", enum: ["1.0.0"] },
              schemaDigest: {
                type: "string",
                enum: [SEMANTIC_PROJECTOR_SCHEMA_DIGEST]
              }
            }
          },
          projectionId: string,
          targetLanguage: { type: "string", enum: ["typescript"] },
          artifact: {
            type: "object",
            required: ["relativePath"],
            properties: { relativePath: string }
          },
          lineage: {
            type: "object",
            required: [
              "featureId",
              "scenarioId",
              "obligationId",
              "responsibilityId",
              "signalId"
            ],
            properties: {
              featureId: string,
              scenarioId: string,
              obligationId: string,
              responsibilityId: string,
              signalId: string
            }
          },
          function: {
            type: "object",
            required: [
              "identity",
              "name",
              "contextParameter",
              "resultTypeReference",
              "semanticEdgeId",
              "awaited"
            ],
            properties: {
              identity: string,
              name: string,
              contextParameter: {
                type: "object",
                required: ["name", "typeReference"],
                properties: { name: string, typeReference: string }
              },
              resultTypeReference: string,
              semanticEdgeId: string,
              awaited: { type: "boolean" }
            }
          }
        }
      }
    }
  };
}

function expectedValues(intent: ConveyorIntent): Record<string, string> {
  return {
    ...intent.identities,
    ...intent.body,
    semanticEdgeId: intent.identities.semanticOperationId
  };
}

function findsLaneViolation(
  candidate: unknown,
  intent: ConveyorIntent,
  laneId: ConveyorLaneId
): string | undefined {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return "Model submission is not an object";
  }
  const record = candidate as Record<string, unknown>;
  if (laneId === "typescript-body-authority") {
    return findsBodyAuthorityViolation(record, intent);
  }
  const allowed = new Set(["artifactType", ...laneFields[laneId]]);
  if (record["artifactType"] !== laneId) {
    return `artifactType must equal ${laneId}`;
  }
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra !== undefined) {
    return `Property ${extra} is not authorized in ${laneId}`;
  }
  const missing = [...allowed].find(
    (key) => typeof record[key] !== "string" || record[key].length === 0
  );
  if (missing !== undefined) {
    return `Property ${missing} must be a non-empty string`;
  }
  const expected = expectedValues(intent);
  const drift = laneFields[laneId].find(
    (field) => expected[field] !== undefined && record[field] !== expected[field]
  );
  return drift === undefined
    ? undefined
    : `Identity ${drift} drifted: expected ${expected[drift]}, observed ${String(record[drift])}`;
}

function findsBodyAuthorityViolation(
  record: Record<string, unknown>,
  intent: ConveyorIntent
): string | undefined {
  if (
    Object.keys(record).some(
      (key) => !["artifactType", "projectorRequest"].includes(key)
    ) ||
    record["artifactType"] !== "typescript-body-authority" ||
    !isRecord(record["projectorRequest"])
  ) {
    return "TypeScript body authority must contain only artifactType and projectorRequest";
  }
  const request = record["projectorRequest"];
  if (
    !hasExactKeys(request, [
      "contract",
      "projectionId",
      "targetLanguage",
      "artifact",
      "lineage",
      "function"
    ]) ||
    !isRecord(request["contract"]) ||
    !isRecord(request["artifact"]) ||
    !isRecord(request["lineage"]) ||
    !isRecord(request["function"]) ||
    !isRecord(request["function"]["contextParameter"])
  ) {
    return "Projector request structure is not admitted";
  }
  const expected = expectedValues(intent);
  const checks: readonly [unknown, unknown, string][] = [
    [request["contract"]["schemaId"], SEMANTIC_PROJECTOR_SCHEMA_ID, "schemaId"],
    [request["contract"]["schemaVersion"], "1.0.0", "schemaVersion"],
    [
      request["contract"]["schemaDigest"],
      SEMANTIC_PROJECTOR_SCHEMA_DIGEST,
      "schemaDigest"
    ],
    [request["projectionId"], expected["projectionId"], "projectionId"],
    [request["targetLanguage"], "typescript", "targetLanguage"],
    [request["artifact"]["relativePath"], expected["artifactPath"], "artifactPath"],
    [request["lineage"]["featureId"], expected["featureId"], "featureId"],
    [request["lineage"]["scenarioId"], expected["scenarioId"], "scenarioId"],
    [
      request["lineage"]["obligationId"],
      expected["obligationId"],
      "obligationId"
    ],
    [
      request["lineage"]["responsibilityId"],
      expected["responsibilityId"],
      "responsibilityId"
    ],
    [request["lineage"]["signalId"], expected["signalId"], "signalId"],
    [
      request["function"]["identity"],
      expected["responsibilityId"],
      "function.identity"
    ],
    [request["function"]["name"], expected["functionName"], "function.name"],
    [
      request["function"]["contextParameter"]["name"],
      expected["parameterName"],
      "contextParameter.name"
    ],
    [
      request["function"]["contextParameter"]["typeReference"],
      expected["contextType"],
      "contextParameter.typeReference"
    ],
    [
      request["function"]["resultTypeReference"],
      expected["resultType"],
      "resultTypeReference"
    ],
    [
      request["function"]["semanticEdgeId"],
      expected["semanticEdgeId"],
      "semanticEdgeId"
    ],
    [request["function"]["awaited"], true, "awaited"]
  ];
  const drift = checks.find(([observed, required]) => observed !== required);
  if (drift !== undefined) {
    return `${drift[2]} drifted: expected ${String(drift[1])}, observed ${String(drift[0])}`;
  }
  if (
    !hasExactKeys(request["contract"], [
      "schemaId",
      "schemaVersion",
      "schemaDigest"
    ]) ||
    !hasExactKeys(request["artifact"], ["relativePath"]) ||
    !hasExactKeys(request["lineage"], [
      "featureId",
      "scenarioId",
      "obligationId",
      "responsibilityId",
      "signalId"
    ]) ||
    !hasExactKeys(request["function"], [
      "identity",
      "name",
      "contextParameter",
      "resultTypeReference",
      "semanticEdgeId",
      "awaited"
    ]) ||
    !hasExactKeys(request["function"]["contextParameter"], [
      "name",
      "typeReference"
    ])
  ) {
    return "Projector request contains unauthorized fields";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function intentProviderAuthorityId(
  dependencies: ConveyorDependencies
): string {
  return dependencies.providerAuthority.providerAuthorityId;
}

async function writesArtifact(
  outputRoot: string,
  laneId: ConveyorLaneId,
  artifact: AcceptedAuthorityArtifact
): Promise<void> {
  const path = resolve(outputRoot, "authority-conveyor", `${laneId}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writesJsonAuthority(path, artifact);
}

async function readsAcceptedArtifact(
  outputRoot: string,
  laneId: ConveyorLaneId
): Promise<AcceptedAuthorityArtifact | undefined> {
  const path = resolve(outputRoot, "authority-conveyor", `${laneId}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as AcceptedAuthorityArtifact;
  } catch {
    return undefined;
  }
}

async function projectsBody(
  body: AcceptedAuthorityArtifact,
  outputRoot: string,
  projectorRoot: string
): Promise<{
  readonly path: string;
  readonly provenance: NonNullable<ConveyorResult["codeProvenance"]>;
}> {
  const declaredRequest = body["projectorRequest"];
  if (!isRecord(declaredRequest) || !isRecord(declaredRequest["artifact"])) {
    throw new Error("Admitted projector request is missing");
  }
  const artifactPath = declaredRequest["artifact"]["relativePath"];
  if (typeof artifactPath !== "string") {
    throw new Error("Admitted artifact path is missing");
  }
  if (
    artifactPath.includes("\\") ||
    artifactPath.startsWith("/") ||
    /^[A-Za-z]:/.test(artifactPath) ||
    artifactPath.split("/").includes("..") ||
    !artifactPath.endsWith(".ts")
  ) {
    throw new Error(`Unsafe projected artifact path: ${artifactPath}`);
  }
  const originProjectionId = `${String(
    declaredRequest["projectionId"]
  )}-from-${body.attestation.artifactHash.replace("sha256:", "")}`;
  const trustPath = resolve(
    outputRoot,
    "projection-authority",
    "trusted-projector-keys.json"
  );
  const privateKeyPath = resolve(
    projectorRoot,
    ".projector-keys",
    "authority-conveyor-ed25519-private.pem"
  );
  const target = resolve(outputRoot, artifactPath);
  const stagingRoot = await mkdtemp(resolve(tmpdir(), "authority-conveyor-"));
  try {
    const stagingAuthority = resolve(stagingRoot, "authority");
    const stagingOutput = resolve(stagingRoot, "projected");
    await mkdir(stagingAuthority, { recursive: true });
    await writesJsonAuthority(
      resolve(stagingAuthority, "body.projector.json"),
      { ...declaredRequest, projectionId: originProjectionId }
    );
    await runsNpm(projectorRoot, [
      "run",
      "project-authority-tree",
      "--",
      "--authority-root",
      stagingAuthority,
      "--output-root",
      stagingOutput
    ]);
    await runsNpm(projectorRoot, [
      "run",
      "project-authority-tree",
      "--",
      "--authority-root",
      stagingAuthority,
      "--output-root",
      stagingOutput,
      "--check"
    ]);
    const stagedBody = await readFile(
      resolve(stagingOutput, artifactPath),
      "utf8"
    );
    if (
      !stagedBody.startsWith("// @generated\n") ||
      !stagedBody.includes("// DO NOT EDIT.\n")
    ) {
      throw new Error(
        "Semantic projector did not produce the admitted staging body"
      );
    }
    await runsNpm(projectorRoot, [
      "run",
      "init-signing-key",
      "--",
      "--private-key",
      privateKeyPath,
      "--trust-file",
      trustPath,
      "--projector-id",
      "declarative-typescript-body-projector"
    ]);
    const trust = JSON.parse(await readFile(trustPath, "utf8")) as {
      keys: readonly { keyId: string }[];
    };
    const keyId = trust.keys[0]?.keyId;
    if (keyId === undefined) throw new Error("Projector trust key missing");
    await runsNpm(projectorRoot, [
      "run",
      "adopt-ast-tree",
      "--",
      "--source-root",
      stagingOutput,
      "--schema",
      resolve(projectorRoot, "contracts", "lossless-typescript-ast-projection.schema.json"),
      "--key-id",
      keyId,
      "--projector-id",
      "declarative-typescript-body-projector"
    ]);
    const stagedAuthorityPath = resolve(
      stagingOutput,
      `${artifactPath}.ast.authority.json`
    );
    const signedAstAuthority = JSON.parse(
      await readFile(stagedAuthorityPath, "utf8")
    ) as Record<string, unknown>;
    signedAstAuthority["projectionId"] = originProjectionId;
    await mkdir(dirname(target), { recursive: true });
    await writesJsonAuthority(
      `${target}.ast.authority.json`,
      signedAstAuthority
    );
    await runsNpm(projectorRoot, [
      "run",
      "project-authority-tree",
      "--",
      "--authority-root",
      outputRoot,
      "--output-root",
      outputRoot,
      "--signing-key",
      privateKeyPath,
      "--trusted-keys",
      trustPath
    ]);
    await runsNpm(projectorRoot, [
      "run",
      "project-authority-tree",
      "--",
      "--authority-root",
      outputRoot,
      "--output-root",
      outputRoot,
      "--trusted-keys",
      trustPath,
      "--check"
    ]);
    const provenance = verifiesProjectedBodyProvenance(
      await readFile(target, "utf8"),
      body.attestation.artifactHash,
      originProjectionId
    );
    return { path: target, provenance };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function verifiesProjectedBodyProvenance(
  source: string,
  expectedSourceAuthorityHash: string,
  expectedProjectionId: string
): NonNullable<ConveyorResult["codeProvenance"]> {
  const readsHeader = (name: string): string | undefined =>
    new RegExp(`^// ${name}: (.+)$`, "m").exec(source)?.[1];
  const projectorId = readsHeader("projector-id");
  const projectorKeyId = readsHeader("projector-key-id");
  const projectionSignature = readsHeader("projection-signature");
  const projectionId = readsHeader("projection-id");
  if (
    projectorId !== "declarative-typescript-body-projector" ||
    projectorKeyId === undefined ||
    projectionSignature === undefined ||
    projectionId !== expectedProjectionId ||
    !projectionId.endsWith(
      expectedSourceAuthorityHash.replace("sha256:", "")
    )
  ) {
    throw new Error(
      "Projected body does not prove its admitted conveyor authority and projector origin"
    );
  }
  return {
    sourceAuthorityHash: expectedSourceAuthorityHash,
    projectorId: "declarative-typescript-body-projector",
    projectorKeyId,
    projectionSignature
  };
}

async function runsNpm(cwd: string, args: readonly string[]): Promise<void> {
  const npmCli = process.env["npm_execpath"];
  const executable = npmCli === undefined ? "npm" : process.execPath;
  const executableArgs = npmCli === undefined ? [...args] : [npmCli, ...args];
  const result = await executes(executable, executableArgs, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
}
