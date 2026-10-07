"use client";

import { UserRound } from "lucide-react";
import { useId } from "react";

import { useAction } from "@/hooks/use-action";

import { switchIdentityAction } from "../actions";

export const ALL_IDENTITIES = "all";

/** "Writing as" selector: narrows the library and sets the pen name for new work. */
export function IdentitySwitcher({
  penNames,
  activePenNameId,
}: {
  penNames: { id: string; name: string }[];
  activePenNameId: string | null;
}) {
  const { run, pending, error } = useAction(switchIdentityAction);
  const id = useId();

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase"
      >
        <UserRound className="size-3.5" aria-hidden />
        Writing as
      </label>
      <select
        id={id}
        value={activePenNameId ?? ALL_IDENTITIES}
        disabled={pending}
        onChange={(e) => run(e.target.value === ALL_IDENTITIES ? null : e.target.value)}
        className="h-9 w-full rounded-sm border border-border-strong bg-surface-input px-2 text-sm font-medium focus-visible:focus-ring disabled:opacity-60"
      >
        <option value={ALL_IDENTITIES}>All identities</option>
        {penNames.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
