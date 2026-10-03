import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { search } from "@/modules/search";
import { NODE_KIND_LABELS } from "@/modules/story-graph";
import { requireAuthorContext } from "@/server/context";

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
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").slice(0, 200);
  const results = q.trim() ? await search(ctx, { query: q, penNameId: ctx.activePenNameId }) : [];

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
        <Button type="submit">Search</Button>
      </form>
      {q.trim() &&
        (results.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing found for “{q}”.</p>
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
