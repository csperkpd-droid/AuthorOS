import { z } from "zod";

export const relationshipDetails = z.object({
  type: z
    .string()
    .trim()
    .min(1, "Describe the relationship in a word or two (e.g. “Sisters”).")
    .max(120, "Keep the type under 120 characters."),
  description: z
    .string()
    .trim()
    .max(5000, "Keep the description under 5,000 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});
export type RelationshipDetails = z.input<typeof relationshipDetails>;

/**
 * A relationship between two or more characters: `characterIds`, or (for a
 * pair) `characterId` + `otherCharacterId`.
 */
export const newRelationshipInput = relationshipDetails
  .extend({
    characterIds: z.array(z.uuid()).optional(),
    characterId: z.uuid().optional(),
    otherCharacterId: z.uuid().optional(),
  })
  .transform(({ characterIds, characterId, otherCharacterId, ...rest }) => ({
    ...rest,
    characterIds: [
      ...new Set(characterIds ?? [characterId, otherCharacterId].filter((c): c is string => !!c)),
    ],
  }))
  .refine((v) => v.characterIds.length <= 12, { message: "Choose at most 12 characters." });
export type NewRelationshipInput = z.input<typeof newRelationshipInput>;

export const RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Romance",
  "Friends",
  "Family",
  "Siblings",
  "Rivals",
  "Enemies",
  "Mentor",
  "Colleagues",
  "Exes",
];
