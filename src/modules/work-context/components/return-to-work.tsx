"use client";

import { CornerUpLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  readWork,
  requestRestore,
  returnTarget,
  subscribeWork,
  workSnapshot,
  writeWork,
  type WorkEntry,
} from "@/lib/work-place";
import { cn } from "@/lib/utils";

import { listWorkPlacesAction } from "../actions";

type Resolved = { id: string; title: string; context: string | null };

/**
 * Return to Work (M10): back to the place being worked on before the
 * current detour, wherever the author wandered (not one step back: that's
 * the browser's Back). Shown only while away from it. The title comes from
 * the server through the read funnel, so a place that is gone or no longer
 * viewable is quietly dropped and never named.
 */
export function ReturnToWork({ owner, compact = false }: { owner: string; compact?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const raw = useSyncExternalStore(
    subscribeWork,
    () => workSnapshot(owner),
    () => "[]",
  );
  const stack = useMemo(() => {
    try {
      return JSON.parse(raw) as WorkEntry[];
    } catch {
      return [];
    }
  }, [raw]);
  const target = returnTarget(stack, pathname);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void listWorkPlacesAction([target.id]).then((result) => {
      if (cancelled || !result.ok) return;
      const place = result.data.find((p) => p.id === target.id);
      if (place) setResolved({ id: place.id, title: place.title, context: place.context });
      // Gone, in the Trash or no longer viewable: forget it, say nothing about it.
      else
        writeWork(
          owner,
          readWork(owner).filter((e) => e.id !== target.id),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [owner, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || resolved?.id !== target.id) return null;

  function go() {
    if (!target) return;
    requestRestore(owner, target.id, target.anchor ?? null);
    router.push(target.href);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={go}
        title={resolved.title}
        className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-secondary px-2.5 py-1.5 text-xs font-medium text-primary"
      >
        <CornerUpLeft className="size-3.5" aria-hidden />
        Return to work
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={go}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-primary/30 bg-secondary px-3 py-2 text-left text-sm text-primary hover:bg-primary/15",
      )}
    >
      <CornerUpLeft className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium">Return to work</span>
        <span className="block truncate text-xs text-foreground">{resolved.title}</span>
        {resolved.context && (
          <span className="block truncate text-xs text-muted-foreground">{resolved.context}</span>
        )}
      </span>
    </button>
  );
}
