import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A styled native select: accessible and mobile-friendly by default. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-sm border border-border-strong bg-surface-input px-3 text-sm focus-visible:focus-ring disabled:bg-surface-disabled disabled:text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}
