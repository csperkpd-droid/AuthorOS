"use client";

import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

import type { ImpactReport } from "../types";

/**
 * Shows a Change Impact report ("What will this affect?") with the three
 * choices: apply everything, review every affected item, or cancel. Generic:
 * any meaningful change can produce a report and reuse this.
 */
export function ImpactReview({
  report,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  report: ImpactReport;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const blocked = report.blockers.length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{report.description}</p>

      <section aria-labelledby="impact-heading" className="space-y-2">
        <h3 id="impact-heading" className="text-sm font-medium">
          What will this affect?
        </h3>
        <ul
          aria-label="Affected story data"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {report.groups.map((g) => (
            <li key={g.key} className="space-y-1 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium">
                  {g.label}
                  {g.items.length > 0 && (
                    <span className="ml-1 text-muted-foreground">({g.items.length})</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{g.effect}</p>
              </div>
              {g.summary && <p className="text-xs text-muted-foreground">{g.summary}</p>}
              {reviewing && g.items.length > 0 && (
                <ul aria-label={g.label} className="mt-1 space-y-0.5 text-sm">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap gap-x-2">
                      {i.href ? (
                        <Link href={i.href} className="text-primary hover:underline">
                          {i.title}
                        </Link>
                      ) : (
                        <span>{i.title}</span>
                      )}
                      {i.note && <span className="text-muted-foreground">· {i.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {blocked && (
        <section
          role="alert"
          aria-label="Needs your attention first"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            Needs your attention first
          </p>
          <p className="text-xs text-muted-foreground">
            These are linked to what’s moving but belong to other work. Remove the links (or move
            that work too), then review again. Nothing has been changed.
          </p>
          <ul className="space-y-1 text-sm">
            {report.blockers.map((b, i) => (
              <li key={i}>
                {b.href ? (
                  <Link href={b.href} className="font-medium text-primary hover:underline">
                    {b.title}
                  </Link>
                ) : (
                  <span className="font-medium">{b.title}</span>
                )}
                <span className="text-muted-foreground"> — {b.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FormError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => setReviewing((r) => !r)} aria-expanded={reviewing}>
          {reviewing ? <ChevronDown /> : <ChevronRight />}
          Review changes
        </Button>
        <Button onClick={onConfirm} disabled={pending || blocked}>
          {pending ? "Moving…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
