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

export const newRelationshipInput = relationshipDetails.extend({
  characterId: z.uuid(),
  otherCharacterId: z.uuid(),
});
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
