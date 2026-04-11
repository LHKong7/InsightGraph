export { BackendManager } from "./backend-manager";
export type { BackendManagerEvents } from "./backend-manager";
export { DockerManager } from "./docker-manager";
export { waitForBackend } from "./health-check";
export { checkEnvironment } from "./precheck";
export type { PrecheckResult } from "./precheck";
export { resolveConfig } from "./config";
export type {
  BackendMode,
  InsightGraphElectronConfig,
  ResolvedConfig,
} from "./config";
