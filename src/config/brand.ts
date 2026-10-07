/**
 * The product's public identity (Brand Specification v1.1). Use these
 * instead of retyping the name. Compatibility identifiers that keep the old
 * name ("authoros.workspace", "authoros-drafts", "authoros-signed-out",
 * "authoros-json") are file formats and keys, not branding: never change them.
 */
export const brand = {
  product: "Spellbound Draft",
  company: "Scrollkeep Studio",
  /** "Spellbound Draft, by Scrollkeep Studio." */
  endorsed: "Spellbound Draft, by Scrollkeep Studio",
  /** Marketing only (the public home page); never in app chrome. */
  tagline: "Where stories cast their spell",
  /** From the positioning statement. */
  description:
    "A calm, manuscript-first writing studio for authors of every genre. The manuscript stays in front; characters, places, story maps and series planning sit one quiet step behind it.",
} as const;
