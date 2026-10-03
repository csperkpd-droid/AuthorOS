"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";

import { setRelationshipMembersAction } from "../actions";

/** Chooses who is in a relationship (two or more characters of its pen name). */
export function MembersDialog({
  relationshipId,
  members,
  characters,
  trigger,
}: {
  relationshipId: string;
  members: string[];
  characters: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(members);
  const { run, pending, error } = useAction(setRelationshipMembersAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setChosen(members);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Members"
        description="Two characters make a pair; three or more make a group."
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await run(relationshipId, chosen)).ok) setOpen(false);
          }}
        >
          <fieldset className="max-h-72 space-y-1 overflow-y-auto">
            <legend className="sr-only">Characters in this relationship</legend>
            {characters.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(c.id)}
                  onChange={(e) =>
                    setChosen((list) =>
                      e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <FormError message={error} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{chosen.length} chosen</p>
            <Button type="submit" disabled={pending || chosen.length < 2}>
              Save members
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
