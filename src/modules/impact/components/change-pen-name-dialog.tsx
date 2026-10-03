"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";

import { applyIdentityMoveAction, previewIdentityMoveAction } from "../actions";
import type { ImpactReport } from "../types";
import { ImpactReview } from "./impact-review";

/**
 * Moves a standalone book or a series to another pen name, after showing
 * everything that moves with it. Nothing changes until "Move everything".
 */
export function ChangePenNameDialog({
  kind,
  id,
  title,
  currentPenNameId,
  penNames,
  trigger,
}: {
  kind: "BOOK" | "SERIES";
  id: string;
  title: string;
  currentPenNameId: string;
  penNames: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const options = penNames.filter((p) => p.id !== currentPenNameId);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(options[0]?.id ?? "");
  const [report, setReport] = useState<ImpactReport | null>(null);
  const preview = useAction(previewIdentityMoveAction);
  const apply = useAction(applyIdentityMoveAction);

  function reset(next: boolean) {
    setOpen(next);
    setReport(null);
    preview.setError(null);
    apply.setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={report ? report.title : `Change the pen name of “${title}”`}
        className="max-w-xl"
      >
        {report ? (
          <ImpactReview
            report={report}
            confirmLabel="Move everything"
            pending={apply.pending}
            error={apply.error}
            onCancel={() => reset(false)}
            onConfirm={async () => {
              const result = await apply.run({ kind, id, toPenNameId: to }, report.token);
              if (result.ok) reset(false);
            }}
          />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create another pen name first, on the Pen names page.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await preview.run({ kind, id, toPenNameId: to });
              if (result.ok) setReport(result.data);
            }}
          >
            <Field label="New pen name" htmlFor="change-pen-name">
              <Select id="change-pen-name" value={to} onChange={(e) => setTo(e.target.value)}>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-muted-foreground">
              You’ll see everything that moves with it before anything changes.
            </p>
            <FormError message={preview.error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={preview.pending}>
                {preview.pending ? "Checking…" : "Review impact"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
