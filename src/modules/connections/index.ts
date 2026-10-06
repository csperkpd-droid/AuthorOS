export {
  connect,
  createPlannedConnection,
  disconnect,
  listConnections,
  planConnection,
  updateConnection,
} from "./service";
export type { ConnectionPlan, ConnectionView } from "./service";
export {
  CONNECTION_KINDS,
  CONNECTION_KIND_KEYS,
  canConnect,
  connectionOptionsFor,
  getKind,
  isConnectionKind,
  labelFrom,
} from "./registry";
export type { ConnectionKind, ConnectionKindDef } from "./registry";
