import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-sm border border-border-strong bg-surface-input px-3 text-sm placeholder:text-muted-foreground focus-visible:focus-ring disabled:bg-surface-disabled disabled:text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}
