import { Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { CHARACTER_ROLE_LABELS, listCharacters } from "@/modules/characters";
import { CharacterDialog } from "@/modules/characters/ui";
import { listSeriesOptions } from "@/modules/library";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Characters" };

export default async function CharactersPage() {
  const ctx = await requireAuthorContext();
  const [characters, series] = await Promise.all([listCharacters(ctx), listSeriesOptions(ctx)]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Characters"
        description="Everyone in your story world, and every scene they appear in."
        actions={
          <CharacterDialog
            seriesOptions={series}
            trigger={
              <Button>
                <Plus />
                New character
              </Button>
            }
          />
        }
      />
      {characters.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Users className="size-10 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-serif text-xl">No characters yet</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create characters here, or add them straight from a scene while you write.
          </p>
        </div>
      ) : (
        <ul aria-label="Characters" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <li key={c.id}>
              <Link
                href={`/characters/${c.id}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <p className="font-serif text-lg leading-snug">{c.name}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge>{CHARACTER_ROLE_LABELS[c.role]}</Badge>
                  {c.series && (
                    <Badge className="bg-primary/10 text-primary">{c.series.title}</Badge>
                  )}
                </div>
                {c.summary && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                )}
                <p className="mt-auto text-xs text-muted-foreground">
                  {formatCount(c.sceneCount, "scene")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
