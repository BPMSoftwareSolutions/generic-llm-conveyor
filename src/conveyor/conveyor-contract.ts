import type {
  ModelConnectorDependencies,
  ProviderAuthority
} from "../shared/model-connector-contract.js";

export const CONVEYOR_LANE_IDS = [
  "feature-authority",
  "scenario-authority",
  "obligation-authority",
  "responsibility-authority",
  "signal-authority",
  "semantic-execution-authority",
  "semantic-ast-authority",
  "typescript-body-authority"
] as const;

export type ConveyorLaneId = (typeof CONVEYOR_LANE_IDS)[number];

export interface ConveyorIntent {
  readonly intentId: string;
  readonly statement: string;
  readonly identities: Readonly<{
    featureId: string;
    scenarioId: string;
    obligationId: string;
    responsibilityId: string;
    signalId: string;
    semanticOperationId: string;
    projectionId: string;
  }>;
  readonly body: Readonly<{
    functionName: string;
    parameterName: string;
    contextType: string;
    resultType: string;
    artifactPath: string;
  }>;
}

export interface ConveyorDependencies {
  readonly connector: ModelConnectorDependencies;
  readonly providerAuthority: ProviderAuthority;
  readonly outputRoot: string;
  readonly conveyorPrivateKeyPath: string;
  readonly conveyorTrustPath: string;
  readonly projectorRoot: string;
  readonly resumeAcceptedArtifacts?: boolean;
}

export interface AcceptedAuthorityArtifact {
  readonly artifactType: ConveyorLaneId;
  readonly [name: string]: unknown;
  readonly provenance: Readonly<{
    requestHash: string;
    responseHash: string;
    invocationId: string;
    providerAuthorityId: string;
    resolvedModel: string;
  }>;
  readonly attestation: Readonly<{
    version: "authority-artifact-attestation.v1";
    signerId: "canonical-authority-conveyor";
    keyId: string;
    algorithm: "ed25519";
    artifactHash: string;
    signature: string;
  }>;
}

export interface ConveyorResult {
  readonly disposition: "CONVEYOR_COMPLETED" | "LANE_REJECTED";
  readonly completedLanes: readonly ConveyorLaneId[];
  readonly stoppedAt?: ConveyorLaneId;
  readonly finding?: string;
  readonly generatedBodyPath?: string;
  readonly codeProvenance?: Readonly<{
    sourceAuthorityHash: string;
    projectorId: "declarative-typescript-body-projector";
    projectorKeyId: string;
    projectionSignature: string;
  }>;
  readonly generatedDocumentPath?: string;
}
