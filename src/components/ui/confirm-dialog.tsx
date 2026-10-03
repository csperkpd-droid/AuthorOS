"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "./button";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { FormError } from "./field";

type Result = { ok: true } | { ok: false; error: string };

/** A confirmation step for consequential actions (trash, delete forever). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  navigateTo,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<Result>;
  /** Where to go after a successful confirm (e.g. leaving a trashed book). */
  navigateTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <FormError message={error} />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className={
              destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined
            }
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const result = await onConfirm();
              setPending(false);
              if (!result.ok) return setError(result.error);
              setOpen(false);
              if (navigateTo) router.push(navigateTo);
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
