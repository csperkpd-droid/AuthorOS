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
  /**
   * Green / Yellow / Red (M8): `automatic` consequences happen with the
   * change (factual propagation, listed so nothing is hidden); `suggested`
   * consequences (Yellow) happen only if the author accepts them, one by
   * one. Missing = automatic.
   */
  level?: "automatic" | "suggested";
  /** For suggestions: what accepting does, e.g. "Move them to the Trash too". */
  suggestion?: string;
};

/** Something to resolve before the change can be made. */
export type ImpactBlocker = {
  title: string;
  href: string | null;
  reason: string;
};

/**
 * Green: affects nothing else, applies directly. Yellow: only suggested
 * consequences, for the author to accept or ignore. Red: affects other data
 * (or is blocked): the author approves before anything changes.
 */
export type ImpactLevel = "green" | "yellow" | "red";

export type ImpactReport = {
  title: string;
  description: string;
  level: ImpactLevel;
  /** "This will affect 7 objects: 3 characters, 2 relationships, 1 romance arc, 1 note." */
  summary: string;
  groups: ImpactGroup[];
  blockers: ImpactBlocker[];
  /** Fingerprint of this report; applying requires it to still match. */
  token: string;
};
