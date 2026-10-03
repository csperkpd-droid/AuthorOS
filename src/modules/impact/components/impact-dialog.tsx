"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";

import type { ImpactReport } from "../types";
import { ImpactReview } from "./impact-review";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A confirmation that first shows "What will this affect?": it loads the
 * report when opened, and confirms with the report's token so only what the
 * author reviewed happens.
 */
export function ImpactDialog({
  trigger,
  title,
  loadReport,
  onConfirm,
  confirmLabel,
  navigateTo,
}: {
  trigger: ReactNode;
  /** Shown while the report loads. */
  title: string;
  loadReport: () => Promise<Result<ImpactReport>>;
  onConfirm: (token: string) => Promise<Result<unknown>>;
  confirmLabel: string;
  navigateTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    setError(null);
    setReport(null);
    const result = await loadReport();
    if (result.ok) setReport(result.data);
    else setError(result.error);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={report?.title ?? title} className="max-w-xl">
        {report ? (
          <ImpactReview
            report={report}
            confirmLabel={confirmLabel}
            pending={pending}
            error={error}
            onCancel={() => setOpen(false)}
            onConfirm={async () => {
              setPending(true);
              const result = await onConfirm(report.token);
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setOpen(false);
              if (navigateTo) router.push(navigateTo);
            }}
          />
        ) : error ? (
          <FormError message={error} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Checking what this affects…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
