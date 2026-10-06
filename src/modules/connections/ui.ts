// UI entry point: components and Server Actions. Domain API: ./index.ts
export {
  connectAction,
  disconnectAction,
  searchNodesAction,
  updateConnectionAction,
} from "./actions";
export { AddConnectionDialog } from "./components/add-connection-dialog";
export { ConnectionsPanel } from "./components/connections-panel";
export { NodeLink } from "./components/node-link";
export { CONNECTION_KINDS, connectionOptionsFor, labelFrom } from "./registry";
export type { ConnectionKind } from "./registry";
