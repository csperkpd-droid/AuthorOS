/** The longest task title (the tasks schema allows 300 characters). */
const MAX = 300;

/**
 * A task title from a comment's text (M18, "Make a task"): the comment's
 * words on one line, shortened to fit. Only the comment body is used, never
 * the quoted passage; the author edits the title before saving.
 */
export function taskTitleFromComment(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length <= MAX ? line : `${line.slice(0, MAX - 1).trimEnd()}…`;
}
