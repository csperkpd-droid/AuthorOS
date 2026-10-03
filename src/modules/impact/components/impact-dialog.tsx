"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
  open: controlledOpen,
  onOpenChange,
}: {
  /** Omitted when opened by its parent (`open`), e.g. from a menu item. */
  trigger?: ReactNode;
  /** Shown while the report loads. */
  title: string;
  loadReport: () => Promise<Result<ImpactReport>>;
  /** Applies with the report's token and the suggestions the author accepted. */
  onConfirm: (token: string, accepted: string[]) => Promise<Result<unknown>>;
  confirmLabel: string;
  navigateTo?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (o: boolean) => {
    setOwnOpen(o);
    onOpenChange?.(o);
  };
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

  // Opened by the parent: load the report then.
  useEffect(() => {
    if (!controlledOpen) return;
    let cancelled = false;
    void loadReport().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setReport(result.data);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      cancelled = true;
      setReport(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledOpen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && controlledOpen === undefined) void load();
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent title={report?.title ?? title} className="max-w-xl">
        {report ? (
          <ImpactReview
            report={report}
            confirmLabel={confirmLabel}
            pending={pending}
            error={error}
            onCancel={() => setOpen(false)}
            onConfirm={async (accepted) => {
              setPending(true);
              const result = await onConfirm(report.token, accepted);
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
