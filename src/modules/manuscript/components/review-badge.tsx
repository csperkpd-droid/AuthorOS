import { MessageSquareWarning } from "lucide-react";

/** How many of a scene's comments need review (M16), for the binder. Nothing when none. */
export function ReviewBadge({ count }: { count?: number }) {
  if (!count) return null;
  const label = `${count} ${count === 1 ? "comment needs" : "comments need"} review`;
  return (
    <span
      title={label}
      aria-label={label}
      data-testid="review-count"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-secondary px-1.5 text-xs text-primary"
    >
      <MessageSquareWarning className="size-3" aria-hidden />
      {count}
    </span>
  );
}
