import { NotebookPen, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { getTimelineEvent } from "@/modules/timeline";
import { TimelineEventForm, trashTimelineEventAction } from "@/modules/timeline/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";
import { can } from "@/server/policy";

type Props = PageProps<"/timeline/events/[eventId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const e = await orNotFound(getTimelineEvent(ctx, (await params).eventId));
  return { title: e.title };
}

export default async function TimelineEventPage({ params }: Props) {
  const { eventId } = await params;
  const ctx = await requireAuthorContext();
  const event = await orNotFound(getTimelineEvent(ctx, eventId));
  const connections = await listConnections(ctx, eventId);
  const canEdit = can(ctx, "edit", "storyBible");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href={event.timelineHref} className="hover:text-foreground">
          Timeline
        </Link>
        <span aria-hidden> › </span>
        <Link href={event.owner.href} className="hover:text-foreground">
          {event.owner.title}
        </Link>
      </nav>
      <PageHeader
        title={event.title}
        description="A timeline event: something that happens in the story world. Its place is on the timeline."
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={event.id} />
            {canEdit && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" aria-label="Move event to Trash">
                    <Trash2 />
                  </Button>
                }
                title={`Move “${event.title}” to the Trash?`}
                description="It leaves the timeline. Restore it from the Trash to put it back where it was."
                confirmLabel="Move to Trash"
                destructive
                onConfirm={trashTimelineEventAction.bind(null, event.id)}
                navigateTo={event.timelineHref}
              />
            )}
          </div>
        }
      />
      <TimelineEventForm
        canEdit={canEdit}
        event={{
          id: event.id,
          title: event.title,
          label: event.label,
          description: event.description,
          updatedAt: event.updatedAt.toISOString(),
        }}
      />
      <ConnectionsPanel
        nodeId={event.id}
        nodeKind="TIMELINE_EVENT"
        connections={connections}
        heading="Notes & links"
        actions={
          <NewNoteDialog
            about={{ id: event.id, title: event.title }}
            trigger={
              <Button variant="outline" size="sm">
                <NotebookPen />
                New note
              </Button>
            }
          />
        }
      />
    </div>
  );
}
