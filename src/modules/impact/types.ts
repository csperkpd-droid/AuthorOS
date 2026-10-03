/**
 * A Change Impact report: what a consequential change will affect, shown to
 * the author before anything happens ("What will this affect?"). Factual,
 * not alarming: concrete counts and items, so the author can decide.
 * Client-safe.
 */
export type ImpactItem = {
  id: string;
  title: string;
  href: string | null;
  /** E.g. "in the Trash", "3 values". */
  note?: string;
};

export type ImpactGroup = {
  key: string;
  label: string;
  /** What happens to this group, e.g. "Moves to Rose Hart", "Deleted". */
  effect: string;
  /** How many objects, in the group's own words ("3 characters"). */
  count: number;
  noun: { one: string; many: string };
  /**
   * Whether the change affects these (counted in the summary), or they are
   * listed only to say they stay as they are.
   */
  affected: boolean;
  items: ImpactItem[];
  /** Extra detail when items are too many to list (e.g. "12 chapters · 48 scenes"). */
  detail?: string;
};

/** Something to resolve before the change can be made. */
export type ImpactBlocker = {
  title: string;
  href: string | null;
  reason: string;
};

export type ImpactReport = {
  title: string;
  description: string;
  /** "This will affect 7 objects: 3 characters, 2 relationships, 1 romance arc, 1 note." */
  summary: string;
  groups: ImpactGroup[];
  blockers: ImpactBlocker[];
  /** Fingerprint of this report; applying requires it to still match. */
  token: string;
};
