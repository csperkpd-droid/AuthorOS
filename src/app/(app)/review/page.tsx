import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-header";
import {
  countCommentsForReview,
  listCommentsForReview,
  type ReviewState,
} from "@/modules/comments";
import { ReviewList } from "@/modules/comments/ui";
import { getPenName } from "@/modules/pen-names";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Review" };

/** The views, as they appear in the address (`/review?view=open`). */
const VIEWS = { "needs-review": "NEEDS_REVIEW", open: "OPEN", resolved: "RESOLVED" } as const;

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const ctx = await requireAuthorContext();
  const params = await searchParams;
  const view = (
    typeof params.view === "string" && Object.hasOwn(VIEWS, params.view)
      ? params.view
      : "needs-review"
  ) as keyof typeof VIEWS;
  const state: ReviewState = VIEWS[view];
  const [counts, first, pen] = await Promise.all([
    countCommentsForReview(ctx),
    listCommentsForReview(ctx, { state }),
    ctx.activePenNameId ? getPenName(ctx, ctx.activePenNameId).catch(() => null) : null,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review"
        description={
          pen
            ? `Comments on ${pen.name}’s scenes, and on your notes.`
            : "Comments on your scenes and notes, across all your pen names."
        }
      />
      <ReviewList
        key={`${state}:${ctx.activePenNameId ?? "all"}`}
        state={state}
        counts={counts}
        initial={first.items}
        initialCursor={first.nextCursor}
      />
    </div>
  );
}
