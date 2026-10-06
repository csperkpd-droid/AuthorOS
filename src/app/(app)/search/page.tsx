import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getCharacter } from "@/modules/characters";
import {
  PARTICIPATION_ROLES,
  ROLE_FILTER_LABELS,
  type ParticipationRole,
} from "@/modules/participation";
import { search } from "@/modules/search";
import { NODE_KIND_LABELS } from "@/modules/story-graph";
import { cn } from "@/lib/utils";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

export const metadata: Metadata = { title: "Search" };

/** "the «storm» broke" → text with <mark>s, safely (no HTML from the snippet). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <p className="text-sm text-muted-foreground">
      …
      {parts.map((p, i) =>
        p.startsWith("«") ? (
          <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      …
    </p>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const ctx = await requireAuthorContext();
  const params = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : "");
  const q = one(params.q).slice(0, 200);
  // Scenes a character is in (Scene Participation), optionally by their part.
  const characterId = /^[0-9a-f-]{36}$/i.test(one(params.character)) ? one(params.character) : null;
  const role: ParticipationRole = (PARTICIPATION_ROLES as readonly string[]).includes(
    one(params.role),
  )
    ? (one(params.role) as ParticipationRole)
    : "all";
  const character = characterId ? await orNotFound(getCharacter(ctx, characterId)) : null;
  const participant = character ? { characterId: character.id, role } : undefined;
  const results =
    q.trim() || participant
      ? await search(ctx, { query: q, penNameId: ctx.activePenNameId, participant })
      : [];
  const filterHref = (r: ParticipationRole) =>
    `/search?${new URLSearchParams({ ...(q ? { q } : {}), character: characterId!, ...(r !== "all" ? { role: r } : {}) })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description={
          ctx.activePenNameId
            ? "Scenes, notes, characters and everything else of the pen name you’re writing as, plus shared notes and ideas."
            : "Scenes, notes, characters and everything else, across your pen names."
        }
      />
      <form role="search" action="/search" className="flex gap-2">
        <label htmlFor="search-q" className="sr-only">
          Search
        </label>
        <Input
          id="search-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search your story…"
          autoFocus
        />
        {characterId && <input type="hidden" name="character" value={characterId} />}
        {characterId && role !== "all" && <input type="hidden" name="role" value={role} />}
        <Button type="submit">Search</Button>
      </form>
      {character && (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Scenes with <span className="font-medium">{character.name}</span>
            </span>
            <Link
              href={q ? `/search?${new URLSearchParams({ q })}` : "/search"}
              className="text-xs text-muted-foreground underline"
            >
              Show everything
            </Link>
          </p>
          <nav
            aria-label={`${character.name}’s part in the scene`}
            className="flex flex-wrap gap-2"
          >
            {PARTICIPATION_ROLES.map((r) => (
              <Link
                key={r}
                href={filterHref(r)}
                aria-current={r === role ? "page" : undefined}
                className={cn(
                  "rounded-full border border-border px-3 py-1 text-sm hover:bg-muted",
                  r === role && "border-primary/50 bg-primary/10 font-medium",
                )}
              >
                {ROLE_FILTER_LABELS[r]}
              </Link>
            ))}
          </nav>
        </div>
      )}
      {(q.trim() || character) &&
        (results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q.trim() ? `Nothing found for “${q}”.` : "No scenes found."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              {results.length === 1 ? "1 result" : `${results.length} results`}
            </p>
            <ul
              aria-label="Results"
              className="divide-y divide-border rounded-xl border border-border bg-surface"
            >
              {results.map(({ node, snippet }) => (
                <li key={node.id}>
                  <Link href={node.href} className="block space-y-1 p-4 hover:bg-muted/50">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge>{NODE_KIND_LABELS[node.kind].one}</Badge>
                      <span className="font-medium">{node.title}</span>
                      {node.context && (
                        <span className="text-xs text-muted-foreground">{node.context}</span>
                      )}
                    </p>
                    {snippet && <Snippet text={snippet} />}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
