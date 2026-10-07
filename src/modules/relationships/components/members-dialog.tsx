"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

import { ImpactReview, type ImpactReport } from "@/modules/impact/ui";

import { previewRelationshipMembersAction, setRelationshipMembersAction } from "../actions";
import { MEMBER_ROLE_SUGGESTIONS } from "../schemas";

type Member = { id: string; role: string | null };

/**
 * Chooses who is in a relationship (two or more characters of its pen name)
 * and, optionally, each member's role in it (Heroine, MMC, Rival…). Roles
 * belong to the membership, not to the character.
 */
export function MembersDialog({
  relationshipId,
  members,
  characters,
  trigger,
}: {
  relationshipId: string;
  members: Member[];
  characters: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [chosen, setChosen] = useState<Member[]>(members);
  const isChosen = (characterId: string) => chosen.some((m) => m.id === characterId);
  const { run, pending, error, setError } = useAction(setRelationshipMembersAction);
  // Removing members is reviewed first (Change Impact).
  const [report, setReport] = useState<ImpactReport | null>(null);
  const payload = () => chosen.map((m) => ({ characterId: m.id, role: m.role?.trim() || null }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setChosen(members);
        setReport(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Members"
        description="Two characters make a pair; three or more make a group."
      >
        {report && (
          <ImpactReview
            report={report}
            confirmLabel="Save members"
            pending={pending}
            error={error}
            onCancel={() => setReport(null)}
            onConfirm={async () => {
              if ((await run(relationshipId, payload(), report.token)).ok) setOpen(false);
            }}
          />
        )}
        <form
          hidden={Boolean(report)}
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const removes = members.some((m) => !isChosen(m.id));
            if (removes) {
              const preview = await previewRelationshipMembersAction(relationshipId, payload());
              if (!preview.ok) return setError(preview.error);
              setReport(preview.data);
              return;
            }
            const result = await run(relationshipId, payload());
            if (result.ok) setOpen(false);
          }}
        >
          <fieldset className="max-h-72 space-y-1 overflow-y-auto">
            <legend className="sr-only">Characters in this relationship</legend>
            {characters.map((c) => {
              const member = chosen.find((m) => m.id === c.id);
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded px-1 py-1 hover:bg-surface-hover"
                >
                  <label className="flex min-w-32 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isChosen(c.id)}
                      onChange={(e) =>
                        setChosen((list) =>
                          e.target.checked
                            ? [...list, { id: c.id, role: null }]
                            : list.filter((m) => m.id !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                  {member && (
                    <Input
                      aria-label={`${c.name}’s role`}
                      placeholder="Role (optional)"
                      list={`${id}-roles`}
                      maxLength={60}
                      value={member.role ?? ""}
                      onChange={(e) =>
                        setChosen((list) =>
                          list.map((m) => (m.id === c.id ? { ...m, role: e.target.value } : m)),
                        )
                      }
                      className="h-8 w-40"
                    />
                  )}
                </div>
              );
            })}
            <datalist id={`${id}-roles`}>
              {MEMBER_ROLE_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
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
