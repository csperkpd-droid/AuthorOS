import { HeartHandshake, NotebookPen, Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CHARACTER_ROLE_LABELS, getCharacter, listCharacters } from "@/modules/characters";
import { CharacterDialog, ProfileForm, trashCharacterAction } from "@/modules/characters/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { listSeriesOptions } from "@/modules/library";
import { NewNoteDialog } from "@/modules/notes/ui";
import { listRelationships } from "@/modules/relationships";
import { RelationshipDialog } from "@/modules/relationships/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/characters/[characterId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const character = await orNotFound(getCharacter(ctx, (await params).characterId));
  return { title: character.name };
}

export default async function CharacterPage({ params }: Props) {
  const { characterId } = await params;
  const ctx = await requireAuthorContext();
  const [character, connections, relationships, allCharacters, series] = await Promise.all([
    orNotFound(getCharacter(ctx, characterId)),
    listConnections(ctx, characterId),
    listRelationships(ctx, { characterId }),
    listCharacters(ctx),
    listSeriesOptions(ctx),
  ]);
  const characterOptions = allCharacters.map((c) => ({ id: c.id, name: c.name }));

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
            <CharacterDialog
              character={character}
              seriesOptions={series}
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
              const other = r.characterA.id === character.id ? r.characterB : r.characterA;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <Link
                    href={`/relationships/${r.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {other.name}
                  </Link>
                  <Badge>{r.type}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConnectionsPanel
        nodeId={character.id}
        nodeKind="CHARACTER"
        connections={connections}
        heading="Scenes, notes & links"
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
