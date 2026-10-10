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
import { listPlaceScenes } from "@/modules/setting";
import { getPlace } from "@/modules/world";
import { trashPlaceAction, WorldObjectDialog } from "@/modules/world/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/places/[placeId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const place = await orNotFound(getPlace(ctx, (await params).placeId));
  return { title: place.name };
}

export default async function PlacePage({ params }: Props) {
  const { placeId } = await params;
  const ctx = await requireAuthorContext();
  const place = await orNotFound(getPlace(ctx, placeId));
  const [connections, scenes, series, penNames, defaultPen, fields, fieldValues] =
    await Promise.all([
      listConnections(ctx, placeId),
      listPlaceScenes(ctx, placeId),
      listSeriesOptions(ctx),
      listPenNames(ctx),
      getPenNameForNewWork(ctx),
      fieldContext(ctx, placeId).then(async (context) => ({
        definitions: await listFieldDefinitions(ctx, { nodeKind: "PLACE", context }),
        scopes: await fieldScopeOptions(ctx, context),
      })),
      getFieldValues(ctx, placeId),
    ]);

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/places" className="hover:text-foreground">
          Places
        </Link>
      </nav>
      <PageHeader
        title={place.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={place.id} title="Earlier summaries" />
            <WorldObjectDialog
              kind="PLACE"
              object={place}
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
                <Button variant="ghost" aria-label="Move place to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${place.name}” to the Trash?`}
              description="The scenes set here keep their text. Their setting and this place’s links come back if you restore it."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashPlaceAction.bind(null, place.id)}
              navigateTo="/places"
            />
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        {penNames.length > 1 && <Badge>{place.penName.name}</Badge>}
        {place.series && <Badge className="bg-secondary text-primary">{place.series.title}</Badge>}
      </div>
      {place.summary && <p className="max-w-prose text-muted-foreground">{place.summary}</p>}

      <CustomFields
        nodeId={place.id}
        nodeKind="PLACE"
        scopeOptions={fields.scopes}
        definitions={fields.definitions}
        values={fieldValues}
      />

      <section aria-labelledby="scenes-heading" className="space-y-3">
        <h2 id="scenes-heading" className="text-lg font-semibold">
          Scenes set here
        </h2>
        {scenes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scenes yet. Set a scene here from the scene’s “Set in a place”.
          </p>
        ) : (
          <ul
            aria-label={`Scenes set in ${place.name}`}
            className="divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {scenes.map((scene) => (
              <li key={scene.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Link href={scene.href} className="font-medium hover:text-primary hover:underline">
                  {scene.title}
                </Link>
                {scene.context && (
                  <span className="text-xs text-muted-foreground">{scene.context}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConnectionsPanel
        nodeId={place.id}
        nodeKind="PLACE"
        connections={connections}
        heading="Notes & links"
        actions={
          <NewNoteDialog
            about={{ id: place.id, title: place.name }}
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
