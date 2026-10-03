import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getBook } from "@/modules/library";
import { getSceneForEditor } from "@/modules/manuscript";
import { BinderNav, SceneDetails, SceneEditor, trashSceneAction } from "@/modules/manuscript/ui";
import { SceneCast } from "@/modules/characters/ui";
import { RevisionsDialog } from "@/modules/history/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { beatsForScene } from "@/modules/structure";
import { SceneBeats } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/books/[bookId]/scenes/[sceneId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const { scene } = await orNotFound(getSceneForEditor(ctx, (await params).sceneId));
  return { title: scene.title };
}

export default async function ScenePage({ params }: Props) {
  const { bookId, sceneId } = await params;
  const ctx = await requireAuthorContext();
  const [book, editor, connections, beats] = await Promise.all([
    orNotFound(getBook(ctx, bookId)),
    orNotFound(getSceneForEditor(ctx, sceneId)),
    orNotFound(listConnections(ctx, sceneId)),
    beatsForScene(ctx, sceneId),
  ]);
  const cast = connections
    .filter((c) => c.kind === "appears_in")
    .map((c) => ({
      connectionId: c.id,
      characterId: c.other.id,
      name: c.other.title,
      role: c.attribute ?? "PRESENT",
    }));
  const { scene, tree, previous, next } = editor;
  if (scene.bookId !== bookId) notFound();
  const location = [scene.chapter.part?.title, scene.chapter.title].filter(Boolean).join(" › ");

  return (
    <div className="gap-10 lg:grid lg:grid-cols-[14rem_1fr]">
      <aside className="mb-6 lg:sticky lg:top-8 lg:mb-0 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto">
        <BinderNav
          bookId={bookId}
          bookTitle={book.title}
          items={tree.items}
          currentSceneId={scene.id}
        />
      </aside>

      <article className="mx-auto w-full max-w-3xl min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>{location}</p>
          <div className="flex gap-2">
            <RevisionsDialog nodeId={scene.id} />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" aria-label="Move scene to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${scene.title}” to the Trash?`}
              description="You can restore it, with its history, from the Trash."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashSceneAction.bind(null, scene.id, true)}
              navigateTo={`/books/${bookId}`}
            />
          </div>
        </div>

        <SceneDetails
          sceneId={scene.id}
          title={scene.title}
          status={scene.status}
          synopsis={scene.synopsis}
        />
        <SceneBeats beats={beats} />
        <SceneCast sceneId={scene.id} cast={cast} />
        <SceneEditor
          key={scene.id}
          sceneId={scene.id}
          content={scene.content}
          version={scene.version}
          wordCount={scene.wordCount}
        />

        <nav
          aria-label="Scenes"
          className="flex justify-between gap-4 border-t border-border pt-4 text-sm"
        >
          {previous ? (
            <Link
              href={`/books/${bookId}/scenes/${previous.id}`}
              className="flex items-center gap-1 hover:text-primary"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="sr-only">Previous scene: </span>
              <SceneLabel scene={previous} currentChapter={scene.chapter.title} />
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/books/${bookId}/scenes/${next.id}`}
              className="flex items-center gap-1 hover:text-primary"
            >
              <span className="sr-only">Next scene: </span>
              <SceneLabel scene={next} currentChapter={scene.chapter.title} />
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
        </nav>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div>
            <ConnectionsPanel
              nodeId={scene.id}
              nodeKind="SCENE"
              connections={connections}
              heading="Notes & links"
              hideKinds={["appears_in"]}
              emptyText="Notes, research, relationship moments and other links for this scene."
              actions={
                <NewNoteDialog
                  about={{ id: scene.id, title: scene.title }}
                  trigger={
                    <Button variant="outline" size="sm">
                      New note
                    </Button>
                  }
                />
              }
            />
          </div>
        </div>
      </article>
    </div>
  );
}

/** Scene titles repeat across chapters ("Scene 1"), so name the chapter when it changes. */
function SceneLabel({
  scene,
  currentChapter,
}: {
  scene: { title: string; chapterTitle: string };
  currentChapter: string;
}) {
  return scene.chapterTitle === currentChapter ? (
    <>{scene.title}</>
  ) : (
    <>
      <span className="text-muted-foreground">{scene.chapterTitle} ·</span> {scene.title}
    </>
  );
}
