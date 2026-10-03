"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

/** An input that replaces a title while renaming. Enter saves, Escape cancels. */
export function InlineTitleInput({
  initial,
  label,
  onSave,
  onDone,
}: {
  initial: string;
  label: string;
  onSave: (title: string) => Promise<{ ok: boolean }>;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function commit() {
    const title = value.trim();
    if (!title || title === initial) return onDone();
    setSaving(true);
    const result = await onSave(title);
    setSaving(false);
    if (result.ok) onDone();
  }

  return (
    <Input
      aria-label={label}
      value={value}
      autoFocus
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
        if (e.key === "Escape") onDone();
      }}
      className="h-8"
    />
  );
}
