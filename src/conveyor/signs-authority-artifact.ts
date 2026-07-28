import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { canonicalJson } from "../shared/runtime-ports.js";
import type { AcceptedAuthorityArtifact } from "./conveyor-contract.js";

export interface ConveyorTrustAuthority {
  readonly authorityType: "trusted-conveyor-keys.v1";
  readonly signerId: "canonical-authority-conveyor";
  readonly keyId: string;
  readonly algorithm: "ed25519";
  readonly publicKeyPem: string;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function initializesConveyorIdentity(
  privateKeyPath: string,
  trustPath: string
): Promise<ConveyorTrustAuthority> {
  let privateKeyPem: string;
  try {
    privateKeyPem = await readFile(privateKeyPath, "utf8");
  } catch {
    const generated = generateKeyPairSync("ed25519");
    privateKeyPem = generated.privateKey.export({
      format: "pem",
      type: "pkcs8"
    }) as string;
    await mkdir(dirname(privateKeyPath), { recursive: true });
    await writeFile(privateKeyPath, privateKeyPem, { mode: 0o600 });
  }
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({
    format: "pem",
    type: "spki"
  }) as string;
  const keyId = sha256(
    new Uint8Array(
      createPublicKey(publicKeyPem).export({ format: "der", type: "spki" })
    )
  );
  const trust: ConveyorTrustAuthority = {
    authorityType: "trusted-conveyor-keys.v1",
    signerId: "canonical-authority-conveyor",
    keyId,
    algorithm: "ed25519",
    publicKeyPem
  };
  await mkdir(dirname(trustPath), { recursive: true });
  await writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);
  return trust;
}

export async function signsAuthorityArtifact(
  artifact: Record<string, unknown>,
  provenance: AcceptedAuthorityArtifact["provenance"],
  privateKeyPath: string,
  trust: ConveyorTrustAuthority
): Promise<AcceptedAuthorityArtifact> {
  const unsigned = { ...artifact, provenance };
  const artifactHash = sha256(canonicalJson(unsigned));
  const payload = canonicalJson({
    version: "authority-artifact-attestation.v1",
    signerId: trust.signerId,
    keyId: trust.keyId,
    artifactHash
  });
  const privateKey = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  const signature = sign(null, Buffer.from(payload), privateKey).toString(
    "base64"
  );
  return {
    ...unsigned,
    attestation: {
      version: "authority-artifact-attestation.v1",
      signerId: "canonical-authority-conveyor",
      keyId: trust.keyId,
      algorithm: "ed25519",
      artifactHash,
      signature
    }
  } as AcceptedAuthorityArtifact;
}

export function verifiesAuthorityArtifact(
  artifact: AcceptedAuthorityArtifact,
  trust: ConveyorTrustAuthority
): boolean {
  const { attestation, ...unsigned } = artifact;
  if (
    attestation.keyId !== trust.keyId ||
    attestation.signerId !== trust.signerId ||
    attestation.artifactHash !== sha256(canonicalJson(unsigned))
  ) {
    return false;
  }
  const payload = canonicalJson({
    version: attestation.version,
    signerId: attestation.signerId,
    keyId: attestation.keyId,
    artifactHash: attestation.artifactHash
  });
  return verify(
    null,
    Buffer.from(payload),
    createPublicKey(trust.publicKeyPem),
    Buffer.from(attestation.signature, "base64")
  );
}

export async function signsMarkdownProjection(
  markdownBody: string,
  privateKeyPath: string,
  trust: ConveyorTrustAuthority
): Promise<{
  readonly markdown: string;
  readonly contentHash: string;
  readonly signature: string;
}> {
  const contentHash = sha256(markdownBody);
  const payload = canonicalJson({
    version: "signed-markdown-projection.v1",
    projectorId: "canonical-authority-conveyor-document-projector",
    keyId: trust.keyId,
    contentHash
  });
  const privateKey = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  const signature = sign(null, Buffer.from(payload), privateKey).toString(
    "base64"
  );
  const header = [
    "<!-- @generated -->",
    "<!-- projector-id: canonical-authority-conveyor-document-projector -->",
    `<!-- projector-key-id: ${trust.keyId} -->`,
    `<!-- content-sha256: ${contentHash} -->`,
    `<!-- projection-signature: ed25519:${signature} -->`,
    "<!-- DO NOT EDIT. Reproject from the signed artifacts. -->",
    ""
  ].join("\n");
  return { markdown: `${header}${markdownBody}`, contentHash, signature };
}

export function verifiesMarkdownProjection(
  markdown: string,
  trust: ConveyorTrustAuthority
): boolean {
  const reads = (name: string): string | undefined =>
    new RegExp(`^<!-- ${name}: (.+) -->$`, "m").exec(markdown)?.[1];
  const marker = "<!-- DO NOT EDIT. Reproject from the signed artifacts. -->\n";
  const markerIndex = markdown.indexOf(marker);
  const keyId = reads("projector-key-id");
  const contentHash = reads("content-sha256");
  const signatureValue = reads("projection-signature");
  if (
    markerIndex === -1 ||
    keyId !== trust.keyId ||
    contentHash === undefined ||
    signatureValue === undefined ||
    !signatureValue.startsWith("ed25519:")
  ) {
    return false;
  }
  const body = markdown.slice(markerIndex + marker.length);
  if (sha256(body) !== contentHash) return false;
  const payload = canonicalJson({
    version: "signed-markdown-projection.v1",
    projectorId: "canonical-authority-conveyor-document-projector",
    keyId,
    contentHash
  });
  return verify(
    null,
    Buffer.from(payload),
    createPublicKey(trust.publicKeyPem),
    Buffer.from(signatureValue.slice("ed25519:".length), "base64")
  );
}
