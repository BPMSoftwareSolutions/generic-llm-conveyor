import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { ConveyorIntent } from "../../src/conveyor/conveyor-contract.js";
import { runsAuthorityConveyor } from "../../src/conveyor/runs-authority-conveyor.js";
import {
  verifiesAuthorityArtifact,
  type ConveyorTrustAuthority
} from "../../src/conveyor/signs-authority-artifact.js";
import {
  buildsDependencies,
  createsRecordingAdapter,
  geminiAuthority
} from "../acceptance/builds-connector-fixtures.js";

const intent: ConveyorIntent = {
  intentId: "prove-generic-provider-routing",
  statement: "Prove the supplied provider authority owns every lane request.",
  identities: {
    featureId: "generic-provider-routing",
    scenarioId: "route-one-lane",
    obligationId: "use-supplied-authority",
    responsibilityId: "routes-lane",
    signalId: "lane-routing",
    semanticOperationId: "route-lane",
    projectionId: "project-route-lane"
  },
  body: {
    functionName: "routesLane",
    parameterName: "context",
    contextType: "RouteLaneContext",
    resultType: "LaneRoutingSignal",
    artifactPath: "capabilities/routing/routes-lane.ts"
  }
};

describe("Generic conveyor boundaries", () => {
  it("routes lane requests through the caller-supplied provider authority", async () => {
    const authority = {
      ...geminiAuthority,
      providerAuthorityId: "caller-owned-provider"
    };
    const adapter = createsRecordingAdapter(
      "invokes-gemini-model",
      "gemini",
      [{ disposition: "provider-responded", structuredValue: {} }]
    );
    const root = await mkdtemp(resolve(tmpdir(), "generic-conveyor-routing-"));
    try {
      const result = await runsAuthorityConveyor(intent, {
        connector: buildsDependencies([adapter], [authority]),
        providerAuthority: authority,
        outputRoot: resolve(root, "output"),
        conveyorPrivateKeyPath: resolve(root, "keys/private.pem"),
        conveyorTrustPath: resolve(root, "output/authority/trust.json"),
        projectorRoot: resolve(root, "unused-projector")
      });
      assert.equal(result.disposition, "LANE_REJECTED");
      assert.equal(adapter.invocationCount, 1);
      assert.equal(
        adapter.receivedContexts[0]?.provider.authorityId,
        "caller-owned-provider"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false for malformed resume artifacts instead of throwing", () => {
    const trust: ConveyorTrustAuthority = {
      authorityType: "trusted-conveyor-keys.v1",
      signerId: "canonical-authority-conveyor",
      keyId: "sha256:not-a-real-key",
      algorithm: "ed25519",
      publicKeyPem: "not-a-public-key"
    };
    for (const malformed of [undefined, null, {}, { attestation: {} }]) {
      assert.doesNotThrow(() => verifiesAuthorityArtifact(malformed, trust));
      assert.equal(verifiesAuthorityArtifact(malformed, trust), false);
    }
  });
});
