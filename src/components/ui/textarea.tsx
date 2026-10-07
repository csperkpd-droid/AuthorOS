import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-sm border border-border-strong bg-surface-input px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:focus-ring disabled:bg-surface-disabled disabled:text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}
