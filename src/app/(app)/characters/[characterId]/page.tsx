import { HeartHandshake, NotebookPen, Plus, Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { PROFILE_FIELDS } from "@/modules/characters";
import { CHARACTER_ROLE_LABELS, getCharacter, listCharacters } from "@/modules/characters";
import { CharacterDialog, ProfileForm, trashCharacterAction } from "@/modules/characters/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import {
  fieldContext,
  fieldScopeOptions,
  getFieldValues,
  listFieldDefinitions,
} from "@/modules/fields";
import { CustomFields } from "@/modules/fields/ui";
import { listSeriesOptions } from "@/modules/library";
import { NewNoteDialog } from "@/modules/notes/ui";
import {
  describeParticipation,
  listCharacterScenes,
  PARTICIPATION_ROLES,
  ROLE_FILTER_LABELS,
} from "@/modules/participation";
import { getPenNameForNewWork, listPenNames } from "@/modules/pen-names";
import { listRelationships } from "@/modules/relationships";
import { RelationshipDialog, relationshipTitle } from "@/modules/relationships/ui";
import { listOutlines, newStructureOptions } from "@/modules/structure";
import { NewStructureDialog, OutlineList } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/characters/[characterId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const character = await orNotFound(getCharacter(ctx, (await params).characterId));
  return { title: character.name };
}

const PROFILE_LABELS = Object.fromEntries(PROFILE_FIELDS.map((f) => [`profile.${f.id}`, f.label]));

export default async function CharacterPage({ params }: Props) {
  const { characterId } = await params;
  const ctx = await requireAuthorContext();
  const character = await orNotFound(getCharacter(ctx, characterId));
  const penNameId = character.penNameId;
  const [
    connections,
    relationships,
    sameIdentity,
    series,
    penNames,
    defaultPen,
    arcs,
    structureOptions,
    fieldDefinitions,
    fieldValues,
    scenes,
  ] = await Promise.all([
    listConnections(ctx, characterId),
    listRelationships(ctx, { characterId }),
    listCharacters(ctx, { penNameId }),
    listSeriesOptions(ctx),
    listPenNames(ctx),
    getPenNameForNewWork(ctx),
    listOutlines(ctx, { characterId }),
    newStructureOptions(ctx, { penNameId }),
    fieldContext(ctx, characterId).then(async (context) => ({
      definitions: await listFieldDefinitions(ctx, { nodeKind: "CHARACTER", context }),
      scopes: await fieldScopeOptions(ctx, context),
    })),
    getFieldValues(ctx, characterId),
    listCharacterScenes(ctx, characterId),
  ]);
  const sceneCounts = {
    all: scenes.length,
    pov: scenes.filter((s) => s.pov).length,
    present: scenes.filter((s) => s.presence === "PRESENT").length,
    mentioned: scenes.filter((s) => s.presence === "MENTIONED").length,
  };
  // Relationships stay within the character's pen name (and series, if any).
  const characterOptions = sameIdentity
    .filter((c) => !character.series || !c.series || c.series.id === character.series.id)
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/characters" className="hover:text-foreground">
          Characters
        </Link>
      </nav>
      <PageHeader
        title={character.name}
        description={
          character.aliases.length ? `Also known as ${character.aliases.join(", ")}` : undefined
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={character.id} labels={PROFILE_LABELS} />
            <CharacterDialog
              character={character}
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
                <Button variant="ghost" aria-label="Move character to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${character.name}” to the Trash?`}
              description="Their scene appearances, relationships and links come back if you restore them."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashCharacterAction.bind(null, character.id)}
              navigateTo="/characters"
            />
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge>{CHARACTER_ROLE_LABELS[character.role]}</Badge>
        {penNames.length > 1 && <Badge>{character.penName.name}</Badge>}
        {character.series && (
          <Badge className="bg-primary/10 text-primary">{character.series.title}</Badge>
        )}
      </div>
      {character.summary && (
        <p className="max-w-prose text-muted-foreground">{character.summary}</p>
      )}

      <section aria-labelledby="profile-heading" className="space-y-3">
        <h2 id="profile-heading" className="font-serif text-xl">
          Profile
        </h2>
        <ProfileForm characterId={character.id} profile={character.profile} />
      </section>

      <CustomFields
        nodeId={character.id}
        nodeKind="CHARACTER"
        scopeOptions={fieldDefinitions.scopes}
        definitions={fieldDefinitions.definitions}
        values={fieldValues}
      />

      <section aria-label="Relationships" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-xl">Relationships</h2>
          {characterOptions.length > 1 && (
            <RelationshipDialog
              characters={characterOptions}
              fromCharacter={{ id: character.id, name: character.name }}
              trigger={
                <Button variant="outline" size="sm">
                  <HeartHandshake />
                  Add relationship
                </Button>
              }
            />
          )}
        </div>
        {relationships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {relationships.map((r) => {
              // Named by the other members ("Kael", or "Kael & Rowan" for a group).
              const others = r.members.filter((m) => m.id !== character.id);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <Link
                    href={`/relationships/${r.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {relationshipTitle(others.map((m) => m.name))}
                  </Link>
                  <Badge>{r.type}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="scenes-heading" className="space-y-3">
        <h2 id="scenes-heading" className="font-serif text-xl">
          Scenes
        </h2>
        {scenes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not in any scene yet. Add {character.name} from a scene’s “Add character”.
          </p>
        ) : (
          <>
            <nav aria-label="Find scenes by part" className="flex flex-wrap gap-2">
              {PARTICIPATION_ROLES.map((r) => (
                <Link
                  key={r}
                  href={`/search?${new URLSearchParams({ character: character.id, ...(r !== "all" ? { role: r } : {}) })}`}
                  className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted"
                >
                  {ROLE_FILTER_LABELS[r]} ({sceneCounts[r]})
                </Link>
              ))}
            </nav>
            <ul
              aria-label={`Scenes with ${character.name}`}
              className="divide-y divide-border rounded-lg border border-border bg-surface"
            >
              {scenes.slice(0, 50).map(({ scene, presence, pov }) => (
                <li
                  key={scene.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0">
                    <Link
                      href={scene.href}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {scene.title}
                    </Link>
                    {scene.context && (
                      <span className="ml-2 text-xs text-muted-foreground">{scene.context}</span>
                    )}
                  </span>
                  <Badge className={pov ? "bg-primary/10 text-primary" : undefined}>
                    {describeParticipation({ presence, pov })}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="arcs-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="arcs-heading" className="font-serif text-xl">
            Character arcs
          </h2>
          {structureOptions.books.length > 0 && (
            <NewStructureDialog
              {...structureOptions}
              characters={[{ id: character.id, label: character.name }]}
              defaults={{ kind: "CHARACTER_ARC", characterId: character.id }}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus />
                  New arc
                </Button>
              }
            />
          )}
        </div>
        {arcs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No arcs yet. Map how {character.name} changes, beat by beat, onto your scenes.
          </p>
        ) : (
          <OutlineList outlines={arcs} showWork />
        )}
      </section>

      <ConnectionsPanel
        nodeId={character.id}
        nodeKind="CHARACTER"
        connections={connections}
        heading="Notes & links"
        actions={
          <NewNoteDialog
            about={{ id: character.id, title: character.name }}
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
