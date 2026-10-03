import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Ordering with fractional-index keys (see docs/DECISIONS.md #14).
 * Keys are ASCII and compared byte-wise, which matches the `COLLATE "C"`
 * position columns in Postgres.
 */
export type Positioned = { id: string; position: string };

export function comparePositioned(a: Positioned, b: Positioned): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  // Equal keys can only come from concurrent inserts; order them stably.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort(comparePositioned);
}

export type InsertPlan = {
  /** Position for the inserted or moved item. */
  position: string;
  /** Siblings that must be re-keyed first (only when keys collided). */
  rebalanced: Positioned[];
};

/**
 * Plans the position for an item placed directly after `afterId` among
 * `siblings` (null = first). `siblings` must not include the item being moved.
 */
export function planInsertAfter(
  siblings: readonly Positioned[],
  afterId: string | null,
): InsertPlan {
  const sorted = sortByPosition(siblings);
  const index = afterId === null ? -1 : sorted.findIndex((s) => s.id === afterId);
  if (afterId !== null && index === -1) {
    throw new Error(`Sibling ${afterId} not found`);
  }
  const before = index >= 0 ? sorted[index].position : null;
  const after = index + 1 < sorted.length ? sorted[index + 1].position : null;

  if (before === null || after === null || before < after) {
    return { position: generateKeyBetween(before, after), rebalanced: [] };
  }

  // Neighbouring keys collided: give every sibling a fresh, evenly spaced key
  // and leave a slot for the new item.
  const keys = generateNKeysBetween(null, null, sorted.length + 1);
  const rebalanced: Positioned[] = [];
  let k = 0;
  let position = "";
  for (let i = -1; i < sorted.length; i++) {
    if (i >= 0) rebalanced.push({ id: sorted[i].id, position: keys[k++] });
    if (i === index) position = keys[k++];
  }
  return { position, rebalanced };
}

/** Position after the last sibling. */
export function positionAtEnd(siblings: readonly Positioned[]): string {
  const sorted = sortByPosition(siblings);
  return generateKeyBetween(sorted.at(-1)?.position ?? null, null);
}
