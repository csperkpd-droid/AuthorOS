import { Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDay } from "@/lib/dates";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { getEvent } from "@/modules/calendar";
import { EventDialog, trashEventAction } from "@/modules/calendar/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/calendar/events/[eventId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const event = await orNotFound(getEvent(ctx, (await params).eventId));
  return { title: event.title };
}

export default async function EventPage({ params }: Props) {
  const { eventId } = await params;
  const ctx = await requireAuthorContext();
  const [event, connections] = await Promise.all([
    orNotFound(getEvent(ctx, eventId)),
    listConnections(ctx, eventId),
  ]);
  const when = [
    formatDay(event.startsOn, { year: "numeric" }),
    event.endsOn && event.endsOn !== event.startsOn
      ? `to ${formatDay(event.endsOn, { year: "numeric" })}`
      : null,
    event.startTime ? `at ${event.startTime}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link
          href={`/calendar?month=${event.startsOn.slice(0, 7)}`}
          className="hover:text-foreground"
        >
          Calendar
        </Link>
      </nav>
      <PageHeader
        title={event.title}
        description={when}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={event.id} />
            <EventDialog
              event={event}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move event to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${event.title}” to the Trash?`}
              description="You can restore it from the Trash."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashEventAction.bind(null, event.id)}
              navigateTo="/calendar"
            />
          </div>
        }
      />
      {event.description && <p className="max-w-prose whitespace-pre-line">{event.description}</p>}
      <ConnectionsPanel
        nodeId={event.id}
        nodeKind="EVENT"
        connections={connections}
        heading="For"
        emptyText="Connect this event to the book or anything else it’s about."
      />
    </div>
  );
}
