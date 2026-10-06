import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { listCharacters } from "@/modules/characters";
import {
  PARTICIPATION_ROLES,
  ROLE_FILTER_LABELS,
  type ParticipationRole,
} from "@/modules/participation";
import { getTimeline } from "@/modules/timeline";
import { TimelineBoard } from "@/modules/timeline/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";
import { can, canView } from "@/server/policy";

type Props = PageProps<"/timeline/[ownerId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const t = await orNotFound(getTimeline(ctx, (await params).ownerId));
  return { title: `Timeline · ${t.owner.title}` };
}

export default async function TimelinePage({ params, searchParams }: Props) {
  const { ownerId } = await params;
  const query = await searchParams;
  const ctx = await requireAuthorContext();
  const one = (v: unknown) => (typeof v === "string" ? v : "");
  const characterId = /^[0-9a-f-]{36}$/i.test(one(query.character)) ? one(query.character) : "";
  const role: ParticipationRole = (PARTICIPATION_ROLES as readonly string[]).includes(
    one(query.role),
  )
    ? (one(query.role) as ParticipationRole)
    : "all";
  const timeline = await orNotFound(
    getTimeline(ctx, ownerId, characterId ? { characterId, role } : {}),
  );
  const characters = canView(ctx, "storyBible")
    ? await listCharacters(ctx, { penNameId: null })
    : [];

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/timeline" className="hover:text-foreground">
          Timeline
        </Link>
      </nav>
      <PageHeader
        title={timeline.owner.title}
        description="In story order: when things happen in the story. Reading order (the book) is shown beside each scene and doesn’t change here."
      />
      {characters.length > 0 && (
        <form
          action={timeline.owner.href}
          className="flex flex-wrap items-end gap-2 text-sm"
          aria-label="Show one character’s scenes"
        >
          <label className="space-y-1">
            <span className="block font-medium">Character</span>
            <select
              name="character"
              defaultValue={characterId}
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">Everyone</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium">Part in the scene</span>
            <select
              name="role"
              defaultValue={role}
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              {PARTICIPATION_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_FILTER_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            Show
          </Button>
          {characterId && (
            <Link href={timeline.owner.href} className="text-xs text-muted-foreground underline">
              Show everyone
            </Link>
          )}
        </form>
      )}
      <TimelineBoard
        ownerId={timeline.owner.id}
        entries={timeline.entries}
        unplaced={timeline.unplaced}
        canEditScenes={can(ctx, "edit", "manuscript")}
        canEditEvents={can(ctx, "edit", "storyBible")}
        filtered={Boolean(characterId)}
      />
    </div>
  );
}
