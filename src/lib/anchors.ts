/**
 * Text anchors for comments (decision 114, M16): a passage of a scene or note
 * is remembered outside the document, as plain-text offsets plus the exact
 * quote and the text around it, and found again after the text changes.
 *
 * The plain text is the editor's own flattening (`flattenDoc` in
 * `lib/work-place.ts`): text nodes in order, one "\n" between textblocks,
 * nothing for other leaves. `anchorText` computes the same text from the
 * stored document JSON, so the server and the editor always agree on
 * offsets (`tests` compare the two on real documents).
 *
 * Matching is strict (never fuzzy): the exact quote must be found, and its
 * surroundings must say it is the same passage. When that isn't certain the
 * anchor is not moved: the caller flags the comment for the author instead.
 * Client-safe and pure.
 */

/** How much text around the quote is kept, on each side. */
export const ANCHOR_CONTEXT = 32;

/** The longest passage a comment can quote. */
export const MAX_QUOTE = 2000;

export type TextAnchor = {
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
};

/** Node types whose content is inline text (ProseMirror textblocks of the editor's schema). */
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

type JsonNode = { type?: string; text?: string; content?: JsonNode[] };

/** The document's plain text, as the editor flattens it (`flattenDoc`). */
export function anchorText(doc: unknown): string {
  let text = "";
  let blocks = 0;
  const walk = (node: JsonNode) => {
    if (node.type === "text") {
      text += node.text ?? "";
      return;
    }
    if (node.type && TEXTBLOCKS.has(node.type)) {
      if (blocks > 0) text += "\n";
      blocks++;
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (doc && typeof doc === "object")
    for (const child of (doc as JsonNode).content ?? []) walk(child);
  return text;
}

/** The anchor for `start..end` of `text` (with its surrounding context). */
export function makeAnchor(text: string, start: number, end: number): TextAnchor {
  return {
    start,
    end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT),
  };
}

/** Whether `text` around `at..at+quote` agrees with the anchor's prefix and suffix. */
function contextAt(text: string, anchor: TextAnchor, at: number) {
  const end = at + anchor.quote.length;
  const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
  const after = text.slice(end, end + anchor.suffix.length);
  // A prefix shorter than the window means the passage started the text
  // (likewise a short suffix: it ended it); that must still be so.
  const prefix =
    before === anchor.prefix && (anchor.prefix.length === ANCHOR_CONTEXT || at === before.length);
  const suffix =
    after === anchor.suffix &&
    (anchor.suffix.length === ANCHOR_CONTEXT || end + after.length === text.length);
  return { prefix, suffix };
}

function occurrences(text: string, quote: string) {
  const found: number[] = [];
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) found.push(i);
  return found;
}

/**
 * Where the anchored passage is in `text` now, or null when that isn't
 * certain (the quote is gone, or its surroundings don't single out one
 * place). Rules, in order:
 * 1. the same quote and context at the same offsets: unchanged;
 * 2. exactly one place with the quote and both sides of its context;
 * 3. otherwise exactly one place with the quote and one full side of its
 *    context (text was typed or removed on the other side).
 * Never a partial quote, a near match or a guess between several places.
 */
export function findAnchor(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number } | null {
  const { quote } = anchor;
  if (!quote) return null;
  const same = contextAt(text, anchor, anchor.start);
  if (text.slice(anchor.start, anchor.end) === quote && same.prefix && same.suffix)
    return { start: anchor.start, end: anchor.end };
  const scored = occurrences(text, quote).map((at) => ({ at, ...contextAt(text, anchor, at) }));
  const both = scored.filter((s) => s.prefix && s.suffix);
  if (both.length === 1) return { start: both[0].at, end: both[0].at + quote.length };
  if (both.length > 1) return null;
  const one = scored.filter((s) => s.prefix || s.suffix);
  if (one.length === 1) return { start: one[0].at, end: one[0].at + quote.length };
  return null;
}

/**
 * Re-anchors a stored anchor against new text: the new anchor (its context
 * refreshed from the new text) or null when the comment needs review.
 */
export function reanchor(text: string, anchor: TextAnchor): TextAnchor | null {
  const found = findAnchor(text, anchor);
  return found ? makeAnchor(text, found.start, found.end) : null;
}
