"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { formatCount } from "@/lib/format";

import type { ImpactReport } from "../types";

/**
 * Shows a Change Impact report: a factual summary ("This will affect 7
 * items: …"), what happens to each group, and the choices: go ahead, review
 * every affected item, or cancel. Any consequential change can produce a
 * report and reuse this.
 */
export function ImpactReview({
  report,
  confirmLabel,
  pendingLabel = "Working…",
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  report: ImpactReport;
  confirmLabel: string;
  pendingLabel?: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const blocked = report.blockers.length > 0;
  const listed = report.groups.some((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{report.description}</p>
      <p className="font-medium" role="status">
        {report.summary}
      </p>

      {report.groups.length > 0 && (
        <ul
          aria-label="What will this affect?"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {report.groups.map((g) => (
            <li key={g.key} className="space-y-1 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium">
                  {g.label} <span className="text-muted-foreground">({g.count})</span>
                </p>
                <p className="text-xs text-muted-foreground">{g.effect}</p>
              </div>
              {g.detail && <p className="text-xs text-muted-foreground">{g.detail}</p>}
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
      )}

      {blocked && (
        <section
          aria-labelledby="impact-resolve"
          className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
        >
          <h3 id="impact-resolve" className="text-sm font-medium">
            To resolve first ({formatCount(report.blockers.length, "item")})
          </h3>
          <p className="text-xs text-muted-foreground">
            These are linked to what’s changing but belong to other work. Remove the links (or
            change that work too), then review again. Nothing has been changed.
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
        {listed && (
          <Button
            variant="outline"
            onClick={() => setReviewing((r) => !r)}
            aria-expanded={reviewing}
          >
            {reviewing ? <ChevronDown /> : <ChevronRight />}
            Review changes
          </Button>
        )}
        <Button onClick={onConfirm} disabled={pending || blocked}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
