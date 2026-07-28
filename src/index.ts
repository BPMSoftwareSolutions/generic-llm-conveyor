/**
 * Public surface of the generic LLM connector.
 *
 * The CLI and any library consumer enter through the same operation:
 * obtainsModelResponse.
 */

export * from "./shared/model-connector-contract.js";
export {
  canonicalJson,
  createsFixedClock,
  createsSequentialIdentity,
  environmentCredentials,
  sha256Hashes,
  systemClock,
  uuidIdentity,
} from "./shared/runtime-ports.js";

export { obtainsModelResponse } from "./obtains-model-response/obtains-model-response.js";
export { validatesModelRequest } from "./obtains-model-response/validates-model-request.js";
export { resolvesProviderAuthority } from "./obtains-model-response/resolves-provider-authority.js";
export { resolvesModelAlias } from "./obtains-model-response/resolves-model-alias.js";
export { preparesModelInvocationContext } from "./obtains-model-response/prepares-model-invocation-context.js";
export { invokesProviderAdapter } from "./obtains-model-response/invokes-provider-adapter.js";
export { recordsProviderTestimony } from "./obtains-model-response/records-provider-testimony.js";
export { normalizesModelResponse } from "./obtains-model-response/normalizes-model-response.js";
export {
  classifiesModelInvocationFailure,
  isTransientProviderFailure,
} from "./obtains-model-response/classifies-model-invocation-failure.js";
export {
  returnsModelExecutionReceipt,
  returnsPreInvocationReceipt,
} from "./obtains-model-response/returns-model-execution-receipt.js";

export {
  createsGeminiAdapter,
  fetchHttpPort,
  GEMINI_ADAPTER_ID,
  type HttpPort,
} from "../providers/gemini/invokes-gemini-model.js";

export * from "./conveyor/conveyor-contract.js";
export { runsAuthorityConveyor } from "./conveyor/runs-authority-conveyor.js";
export {
  initializesConveyorIdentity,
  signsAuthorityArtifact,
  signsMarkdownProjection,
  verifiesAuthorityArtifact,
  verifiesMarkdownProjection
} from "./conveyor/signs-authority-artifact.js";
export { projectsConveyorDocument } from "./conveyor/projects-conveyor-document.js";
