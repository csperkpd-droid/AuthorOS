"use client";

import { useRef, useState } from "react";

import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { updateProfileFieldAction } from "../actions";
import { PROFILE_FIELDS } from "../profile";

/** Character profile fields; each saves when you leave it. */
export function ProfileForm({
  characterId,
  profile,
}: {
  characterId: string;
  profile: Record<string, string>;
}) {
  const { run, error } = useAction(updateProfileFieldAction);
  const [saved, setSaved] = useState<string | null>(null);
  // Last saved value per field, so leaving an unchanged field doesn't save.
  const lastSaved = useRef<Record<string, string>>({ ...profile });

  async function save(fieldId: string, value: string) {
    if ((lastSaved.current[fieldId] ?? "") === value) return;
    // The value this form last knew: refused if it changed elsewhere since.
    const result = await run(characterId, fieldId, value, lastSaved.current[fieldId] ?? "");
    if (result.ok) {
      lastSaved.current[fieldId] = value;
      setSaved(fieldId);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PROFILE_FIELDS.map((f) => {
        const id = `profile-${f.id}`;
        const common = {
          id,
          defaultValue: profile[f.id] ?? "",
          onBlur: (e: { target: { value: string } }) => void save(f.id, e.target.value),
        };
        return (
          <div key={f.id} className={f.multiline ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <div className="flex items-baseline justify-between">
              <Label htmlFor={id}>{f.label}</Label>
              {saved === f.id && (
                <span role="status" className="text-xs text-muted-foreground">
                  Saved
                </span>
              )}
            </div>
            {f.multiline ? <Textarea rows={3} {...common} /> : <Input {...common} />}
          </div>
        );
      })}
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
    </div>
  );
}
