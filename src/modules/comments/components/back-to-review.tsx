import { ArrowLeft } from "lucide-react";
import Link from "next/link";

const VIEWS = new Set(["needs-review", "open", "resolved"]);

/**
 * The way back to the Review view a comment was opened from (M17). Only a
 * known view name is honoured; anything else shows nothing. This is a link,
 * not Work Context: Return to Work keeps the author's writing place.
 */
export function BackToReview({ from }: { from: string | string[] | undefined }) {
  if (typeof from !== "string" || !VIEWS.has(from)) return null;
  return (
    <Link
      href={`/review?view=${from}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to Review
    </Link>
  );
}
