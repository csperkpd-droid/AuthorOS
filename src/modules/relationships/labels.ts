/**
 * A relationship's name from its members: "Elara & Kael", or for a group
 * "Elara, Kael & Rowan". Client-safe.
 */
export function relationshipTitle(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}
