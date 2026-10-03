"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";

import { createWithinGroupAction } from "../actions";
import { relationshipTitle } from "../labels";

type Dynamic = {
  members: { id: string; name: string }[];
  relationship: { id: string; type: string } | null;
};

/**
 * The relationships within a group: each pair (and any smaller group) can
 * have its own relationship, with its own scenes, notes and arc.
 */
export function GroupDynamics({ dynamics, groupType }: { dynamics: Dynamic[]; groupType: string }) {
  const { run, pending, error } = useAction(createWithinGroupAction);
  return (
    <>
      <ul
        aria-label="Within the group"
        className="divide-y divide-border rounded-lg border border-border bg-surface"
      >
        {dynamics.map((d) => {
          const title = relationshipTitle(d.members.map((m) => m.name));
          return (
            <li
              key={d.members.map((m) => m.id).join()}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              {d.relationship ? (
                <>
                  <Link
                    href={`/relationships/${d.relationship.id}`}
                    className="font-medium hover:underline"
                  >
                    {title}
                  </Link>
                  <Badge>{d.relationship.type}</Badge>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">{title}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Add the relationship between ${title}`}
                    onClick={() =>
                      run(
                        d.members.map((m) => m.id),
                        groupType,
                      )
                    }
                  >
                    <Plus />
                    Add
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
    </>
  );
}
