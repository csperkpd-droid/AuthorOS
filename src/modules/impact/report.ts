import "server-only";

import { createHash } from "node:crypto";

import { ConflictError, RuleError } from "@/lib/errors";
import { formatCount } from "@/lib/format";

import type { ImpactBlocker, ImpactGroup, ImpactReport } from "./types";

type GroupInput = Omit<ImpactGroup, "count" | "affected"> & {
  count?: number;
  affected?: boolean;
};

/**
 * Builds a report from its groups: drops empty groups, writes the factual
 * summary from the affected ones, and fingerprints the content (ids per
 * group, blockers, plus `extra`, anything else the plan depends on).
 */
export function buildReport({
  title,
  description,
  groups,
  blockers = [],
  extra = [],
}: {
  title: string;
  description: string;
  groups: GroupInput[];
  blockers?: ImpactBlocker[];
  extra?: unknown[];
}): ImpactReport {
  const full: ImpactGroup[] = groups
    .map((g) => ({ ...g, count: g.count ?? g.items.length, affected: g.affected ?? true }))
    .filter((g) => g.count > 0 || g.detail);
  const suggested = full.filter((g) => g.level === "suggested" && g.count > 0);
  const affected = full.filter((g) => g.affected && g.count > 0 && g.level !== "suggested");
  const total = affected.reduce((n, g) => n + g.count, 0);
  const summary =
    total === 0
      ? "This doesn’t affect anything else."
      : `This will affect ${formatCount(total, "item")}: ${affected
          .map((g) => formatCount(g.count, g.noun.one, g.noun.many))
          .join(", ")}.`;
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        groups: full.map((g) => [g.key, g.count, g.items.map((i) => i.id).sort()]),
        blockers: blockers.map((b) => b.title).sort(),
        extra,
      }),
    )
    .digest("hex")
    .slice(0, 32);
  const level = blockers.length || affected.length ? "red" : suggested.length ? "yellow" : "green";
  return { title, description, level, summary, groups: full, blockers, token };
}

/** Whether anything besides the object itself would be affected. */
export function affectsOthers(report: ImpactReport, selfKey?: string) {
  return report.groups.some((g) => g.affected && g.count > 0 && g.key !== selfKey);
}

/**
 * Applying a reviewed change. Refused while it has blockers; refused
 * without a review when it affects anything (no silent detaching or
 * orphaning, whichever path calls the service); refused when what it would
 * affect changed since the review (stale token).
 */
export function assertReviewed(
  report: ImpactReport,
  token: string | undefined,
  /** Keys of the suggested consequences the author accepted (Yellow). */
  accepted: string[] = [],
): Set<string> {
  if (report.blockers.length) throw new RuleError(report.blockers[0].reason);
  const suggestions = new Set(
    report.groups.filter((g) => g.level === "suggested" && g.count > 0).map((g) => g.key),
  );
  for (const key of accepted)
    if (!suggestions.has(key)) throw new RuleError("That suggestion isn’t part of this change.");
  if (token === undefined) {
    if (report.level !== "green") throw new RuleError("Review what this change affects first.");
    return new Set();
  }
  if (token !== report.token)
    throw new ConflictError("This changed since you reviewed it. Review it again.");
  return new Set(accepted);
}
