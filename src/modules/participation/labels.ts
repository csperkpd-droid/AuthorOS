import type { ParticipationRole, ScenePresence } from "./schemas";

/** How a character's part in a scene reads (no database terms). */
export const PRESENCE_LABELS: Record<ScenePresence, string> = {
  PRESENT: "Present",
  MENTIONED: "Mentioned",
};

export const PRESENCE_HINTS: Record<ScenePresence, string> = {
  PRESENT: "In the scene",
  MENTIONED: "Talked or thought about, not there",
};

export const ROLE_FILTER_LABELS: Record<ParticipationRole, string> = {
  all: "All scenes",
  pov: "Point of view",
  present: "Present",
  mentioned: "Mentioned",
};

export type ParticipationState = { presence: ScenePresence; pov: boolean } | null;

/** "Point of view, present", "Mentioned", "Not in the scene". */
export function describeParticipation(state: ParticipationState) {
  if (!state) return "Not in the scene";
  const presence = PRESENCE_LABELS[state.presence];
  return state.pov ? `Point of view, ${presence.toLowerCase()}` : presence;
}

/** Why a second point of view is refused (the existing one is never replaced silently). */
export function secondPovMessage(holder: string | null) {
  return holder
    ? `This scene is already told from ${holder}’s point of view. A scene has one point of view: change it to give it to someone else.`
    : "This scene already has a point-of-view character. A scene has one point of view.";
}
