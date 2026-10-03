/** Profile fields shown for every character (client-safe). Stored in `characters.profile` by id. */
export const PROFILE_FIELDS = [
  { id: "age", label: "Age", multiline: false },
  { id: "occupation", label: "Occupation", multiline: false },
  { id: "appearance", label: "Appearance", multiline: true },
  { id: "personality", label: "Personality", multiline: true },
  { id: "backstory", label: "Backstory", multiline: true },
  { id: "goal", label: "Goal", multiline: true },
  { id: "motivation", label: "Motivation", multiline: true },
  { id: "conflict", label: "Inner conflict", multiline: true },
  { id: "voice", label: "Voice & speech", multiline: true },
] as const;

/**
 * Every core character field: the columns and the profile. Core fields and
 * custom fields stay separate systems that never duplicate each other: a
 * custom field can't take a core field's name.
 */
export const CORE_CHARACTER_FIELD_LABELS = [
  "Name",
  "Aliases",
  "Role",
  "Summary",
  "Series",
  ...PROFILE_FIELDS.map((f) => f.label),
];

export type ProfileFieldId = (typeof PROFILE_FIELDS)[number]["id"];

export const PROFILE_FIELD_IDS = PROFILE_FIELDS.map((f) => f.id) as ProfileFieldId[];

export const CHARACTER_ROLE_LABELS = {
  PROTAGONIST: "Protagonist",
  ANTAGONIST: "Antagonist",
  LOVE_INTEREST: "Love interest",
  SUPPORTING: "Supporting",
  MINOR: "Minor",
} as const;
