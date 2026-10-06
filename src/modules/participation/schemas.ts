import { z } from "zod";

export const SCENE_PRESENCES = ["PRESENT", "MENTIONED"] as const;
export type ScenePresence = (typeof SCENE_PRESENCES)[number];

/** Adding a character to a scene. */
export const participantInput = z.object({
  characterId: z.uuid(),
  presence: z.enum(SCENE_PRESENCES).default("PRESENT"),
  /** Tell the scene from this character's point of view. */
  pov: z.boolean().default(false),
});

/** Changing a character's part in a scene (undefined = unchanged). */
export const participantChange = z.object({
  presence: z.enum(SCENE_PRESENCES).optional(),
  pov: z.boolean().optional(),
});

/**
 * Giving the scene's point of view to another character. `expected` is the
 * point-of-view character the author saw (null = none): refused if it
 * changed meanwhile, so nobody's POV is replaced unseen.
 */
export const povChange = z.object({
  characterId: z.uuid(),
  expected: z.uuid().nullable(),
});

/** Which scenes of a character: all, or by their part in it. */
export const PARTICIPATION_ROLES = ["all", "pov", "present", "mentioned"] as const;
export type ParticipationRole = (typeof PARTICIPATION_ROLES)[number];

export type ParticipantInput = z.input<typeof participantInput>;
export type ParticipantChange = z.input<typeof participantChange>;
export type PovChange = z.input<typeof povChange>;
