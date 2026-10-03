/**
 * Writing languages an identity can have, with the Postgres text-search
 * configuration used to stem words in that language ("running" finds
 * "run"). Codes are BCP 47 language tags, so other engines (and regional
 * variants such as "pt-BR") can be supported later. Client-safe.
 */
export const LANGUAGES = [
  { code: "ar", name: "Arabic", search: "arabic" },
  { code: "ca", name: "Catalan", search: "catalan" },
  { code: "da", name: "Danish", search: "danish" },
  { code: "nl", name: "Dutch", search: "dutch" },
  { code: "en", name: "English", search: "english" },
  { code: "fi", name: "Finnish", search: "finnish" },
  { code: "fr", name: "French", search: "french" },
  { code: "de", name: "German", search: "german" },
  { code: "el", name: "Greek", search: "greek" },
  { code: "hi", name: "Hindi", search: "hindi" },
  { code: "hu", name: "Hungarian", search: "hungarian" },
  { code: "id", name: "Indonesian", search: "indonesian" },
  { code: "ga", name: "Irish", search: "irish" },
  { code: "it", name: "Italian", search: "italian" },
  { code: "lt", name: "Lithuanian", search: "lithuanian" },
  { code: "ne", name: "Nepali", search: "nepali" },
  { code: "no", name: "Norwegian", search: "norwegian" },
  { code: "pt", name: "Portuguese", search: "portuguese" },
  { code: "ro", name: "Romanian", search: "romanian" },
  { code: "ru", name: "Russian", search: "russian" },
  { code: "sr", name: "Serbian", search: "serbian" },
  { code: "es", name: "Spanish", search: "spanish" },
  { code: "sv", name: "Swedish", search: "swedish" },
  { code: "ta", name: "Tamil", search: "tamil" },
  { code: "tr", name: "Turkish", search: "turkish" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** The text-search configuration for a language tag ("pt-BR" → portuguese); 'simple' if none. */
export function searchConfigFor(language: string | null | undefined): string {
  if (!language) return "simple";
  const base = language.toLowerCase().split("-")[0];
  return LANGUAGES.find((l) => l.code === base)?.search ?? "simple";
}

export function languageName(language: string | null | undefined): string | null {
  if (!language) return null;
  const base = language.toLowerCase().split("-")[0];
  return LANGUAGES.find((l) => l.code === base)?.name ?? language;
}
