import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listCharacters } from "@/modules/characters";
import { listRelationships } from "@/modules/relationships";
import { RelationshipDialog } from "@/modules/relationships/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Relationships" };

export default async function RelationshipsPage() {
  const ctx = await requireAuthorContext();
  const [relationships, characters] = await Promise.all([
    listRelationships(ctx, { penNameId: ctx.activePenNameId }),
    listCharacters(ctx, { penNameId: ctx.activePenNameId }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Relationships"
        description="How your characters connect, and the scenes where that changes."
        actions={
          characters.length > 1 ? (
            <RelationshipDialog
              characters={characters.map((c) => ({ id: c.id, name: c.name }))}
              trigger={
                <Button>
                  <HeartHandshake />
                  New relationship
                </Button>
              }
            />
          ) : undefined
        }
      />
      {relationships.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {characters.length > 1
            ? "No relationships yet."
            : "Create at least two characters to connect them."}
        </p>
      ) : (
        <ul
          aria-label="Relationships"
          className="divide-y divide-border rounded-xl border border-border bg-surface"
        >
          {relationships.map((r) => (
            <li key={r.id}>
              <Link
                href={`/relationships/${r.id}`}
                className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/50"
              >
                <span className="flex-1 font-medium">{r.title}</span>
                {r.members.length > 2 && (
                  <Badge className="bg-primary/10 text-primary">Group of {r.members.length}</Badge>
                )}
                <Badge>{r.type}</Badge>
                {r.description && (
                  <span className="w-full truncate text-sm text-muted-foreground">
                    {r.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
