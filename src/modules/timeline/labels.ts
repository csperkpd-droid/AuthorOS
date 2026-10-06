/** Example narrative-time labels: free-form, never dates. */
export const STORY_TIME_EXAMPLES = [
  "Day 3, evening",
  "Ten years earlier",
  "The following winter",
  "Before the wedding",
  "Unknown",
];

/** "Story time: Day 3, evening · 4th in story order". */
export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
