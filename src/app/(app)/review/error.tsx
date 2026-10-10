"use client";

import { Button } from "@/components/ui/button";

/**
 * Review couldn't be loaded. Nothing about the comments is shown or logged
 * here; trying again reloads the page's data.
 */
export default function ReviewError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold">Review couldn’t be loaded</h1>
      <p className="text-sm text-muted-foreground">
        Your comments are safe. Check your connection, then try again.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
