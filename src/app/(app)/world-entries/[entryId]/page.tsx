import { NotebookPen, Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import {
  fieldContext,
  fieldScopeOptions,
  getFieldValues,
  listFieldDefinitions,
} from "@/modules/fields";
import { CustomFields } from "@/modules/fields/ui";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { listSeriesOptions } from "@/modules/library";
import { NewNoteDialog } from "@/modules/notes/ui";
import { getPenNameForNewWork, listPenNames } from "@/modules/pen-names";
import { getWorldEntry, listWorldEntryTypes } from "@/modules/world";
import { trashWorldEntryAction, WorldObjectDialog } from "@/modules/world/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/world-entries/[entryId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const entry = await orNotFound(getWorldEntry(ctx, (await params).entryId));
  return { title: entry.name };
}

export default async function WorldEntryPage({ params }: Props) {
  const { entryId } = await params;
  const ctx = await requireAuthorContext();
  const entry = await orNotFound(getWorldEntry(ctx, entryId));
  const [connections, types, series, penNames, defaultPen, fields, fieldValues] = await Promise.all(
    [
      listConnections(ctx, entryId),
      listWorldEntryTypes(ctx),
      listSeriesOptions(ctx),
      listPenNames(ctx),
      getPenNameForNewWork(ctx),
      fieldContext(ctx, entryId).then(async (context) => ({
        definitions: await listFieldDefinitions(ctx, { nodeKind: "WORLD_ENTRY", context }),
        scopes: await fieldScopeOptions(ctx, context),
      })),
      getFieldValues(ctx, entryId),
    ],
  );

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/world-entries" className="hover:text-foreground">
          World
        </Link>
      </nav>
      <PageHeader
        title={entry.name}
        description={entry.entryType}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={entry.id} title="Earlier summaries" />
            <WorldObjectDialog
              kind="WORLD_ENTRY"
              object={entry}
              entryTypes={types}
              seriesOptions={series}
              penNames={penNames}
              defaultPenNameId={defaultPen.id}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move world entry to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${entry.name}” to the Trash?`}
              description="Its links come back if you restore it."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashWorldEntryAction.bind(null, entry.id)}
              navigateTo="/world-entries"
            />
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge>{entry.entryType}</Badge>
        {penNames.length > 1 && <Badge>{entry.penName.name}</Badge>}
        {entry.series && <Badge className="bg-secondary text-primary">{entry.series.title}</Badge>}
      </div>
      {entry.summary && <p className="max-w-prose text-muted-foreground">{entry.summary}</p>}

      <CustomFields
        nodeId={entry.id}
        nodeKind="WORLD_ENTRY"
        scopeOptions={fields.scopes}
        definitions={fields.definitions}
        values={fieldValues}
      />

      <ConnectionsPanel
        nodeId={entry.id}
        nodeKind="WORLD_ENTRY"
        connections={connections}
        heading="Notes & links"
        emptyText="Link this to characters, places, scenes and other story objects."
        actions={
          <NewNoteDialog
            about={{ id: entry.id, title: entry.name }}
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
