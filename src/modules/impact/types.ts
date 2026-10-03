import type { StoryNodeKind } from "@/generated/prisma/enums";

/**
 * A Change Impact report: what a meaningful change will affect, shown to the
 * author before anything happens ("What will this affect?"). Client-safe.
 */
export type ImpactItem = {
  id: string;
  title: string;
  href: string | null;
  /** E.g. "in the Trash", "copied to Rose Hart". */
  note?: string;
};

export type ImpactGroup = {
  key: StoryNodeKind | "FIELD" | "SHARED";
  label: string;
  /** What happens to this group, e.g. "Move to Rose Hart". */
  effect: string;
  items: ImpactItem[];
  /** A one-line summary when items are too many to list (e.g. "48 scenes"). */
  summary?: string;
};

/** Something that prevents the change until the author resolves it. */
export type ImpactBlocker = {
  title: string;
  href: string | null;
  reason: string;
};

export type ImpactReport = {
  title: string;
  description: string;
  groups: ImpactGroup[];
  blockers: ImpactBlocker[];
  /** Fingerprint of this report; applying requires it to still match. */
  token: string;
};
