// UI entry point: components and Server Actions. Domain API: ./index.ts
export {
  addToSceneAction,
  listParticipationHistoryAction,
  removeParticipantAction,
  setPointOfViewAction,
  updateParticipantAction,
} from "./actions";
export { SceneParticipants } from "./components/scene-participants";
export type { SceneParticipant } from "./components/scene-participants";
export {
  describeParticipation,
  PRESENCE_LABELS,
  ROLE_FILTER_LABELS,
  secondPovMessage,
} from "./labels";
export { PARTICIPATION_ROLES, SCENE_PRESENCES } from "./schemas";
export type { ParticipationRole, ScenePresence } from "./schemas";
