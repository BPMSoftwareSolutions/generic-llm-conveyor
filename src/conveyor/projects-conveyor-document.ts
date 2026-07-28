import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  CONVEYOR_LANE_IDS,
  type AcceptedAuthorityArtifact,
  type ConveyorResult
} from "./conveyor-contract.js";
import {
  signsMarkdownProjection,
  type ConveyorTrustAuthority
} from "./signs-authority-artifact.js";

export async function projectsConveyorDocument(options: {
  readonly outputRoot: string;
  readonly artifacts: readonly AcceptedAuthorityArtifact[];
  readonly generatedBodyPath: string;
  readonly codeProvenance: NonNullable<ConveyorResult["codeProvenance"]>;
  readonly privateKeyPath: string;
  readonly trust: ConveyorTrustAuthority;
}): Promise<string> {
  const {
    outputRoot,
    artifacts,
    generatedBodyPath,
    codeProvenance,
    privateKeyPath,
    trust
  } = options;
  const artifactByLane = new Map(
    artifacts.map((artifact) => [artifact.artifactType, artifact])
  );
  const bodyAuthority = artifactByLane.get("typescript-body-authority");
  if (bodyAuthority === undefined) {
    throw new Error("Cannot document a missing TypeScript body authority");
  }
  const bodyLink = linkFrom(outputRoot, generatedBodyPath);
  const astLink = `${bodyLink}.ast.authority.json`;
  const laneSections = CONVEYOR_LANE_IDS.map((laneId, index) => {
    const artifact = artifactByLane.get(laneId);
    if (artifact === undefined) {
      throw new Error(`Cannot document missing lane artifact ${laneId}`);
    }
    const artifactLink = `authority-conveyor/${laneId}.json`;
    return [
      `### ${index + 1}. ${laneId}`,
      "",
      `- Artifact: [${laneId}.json](${artifactLink})`,
      `- Provider authority: \`${artifact.provenance.providerAuthorityId}\``,
      `- Resolved live model: \`${artifact.provenance.resolvedModel}\``,
      `- Live invocation ID: \`${artifact.provenance.invocationId}\``,
      `- Model request hash: \`${artifact.provenance.requestHash}\``,
      `- Model response hash: \`${artifact.provenance.responseHash}\``,
      `- Admitted artifact hash: \`${artifact.attestation.artifactHash}\``,
      `- Conveyor key: \`${artifact.attestation.keyId}\``,
      `- Admission signature over the LLM submission and testimony: \`${artifact.attestation.algorithm}:${artifact.attestation.signature}\``,
      ""
    ].join("\n");
  }).join("\n");
  const markdownBody = [
    "# Live LLM Authority Conveyor — Generated Bodies",
    "",
    "This is a deterministic projection of the signed artifacts linked below.",
    "It is an index, not a detached receipt: the linked artifacts and generated",
    "body carry their own hashes and signatures.",
    "",
    "## Live conveyor run",
    "",
    `- Completed lanes: ${CONVEYOR_LANE_IDS.length}/${CONVEYOR_LANE_IDS.length}`,
    `- Provider: \`${bodyAuthority.provenance.providerAuthorityId}\``,
    `- Final live model: \`${bodyAuthority.provenance.resolvedModel}\``,
    `- Final live invocation: \`${bodyAuthority.provenance.invocationId}\``,
    "",
    "## LLM-generated authority bodies",
    "",
    laneSections,
    "## Projector-generated executable bodies",
    "",
    "### greets-student.ts",
    "",
    `- Generated TypeScript: [${bodyLink}](${bodyLink})`,
    `- Compiler AST authority: [${astLink}](${astLink})`,
    "- Admitted LLM TypeScript-body authority: [typescript-body-authority.json](authority-conveyor/typescript-body-authority.json)",
    `- Source authority hash embedded in projection identity: \`${codeProvenance.sourceAuthorityHash}\``,
    `- Projector: \`${codeProvenance.projectorId}\``,
    `- Projector key: \`${codeProvenance.projectorKeyId}\``,
    `- Projector signature: \`${codeProvenance.projectionSignature}\``,
    "",
    "## Provenance chain",
    "",
    "```text",
    "Live model invocation",
    "  → signed admitted authority artifact",
    "  → semantic projector byte-conformance",
    "  → compiler AST authority",
    "  → signed deterministic TypeScript projection",
    "  → executable semantic-edge body",
    "```",
    ""
  ].join("\n");
  const signed = await signsMarkdownProjection(
    markdownBody,
    privateKeyPath,
    trust
  );
  const documentPath = resolve(outputRoot, "CONVEYOR-GENERATED-BODIES.md");
  await mkdir(dirname(documentPath), { recursive: true });
  await writeFile(documentPath, signed.markdown);
  return documentPath;
}

function linkFrom(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}
