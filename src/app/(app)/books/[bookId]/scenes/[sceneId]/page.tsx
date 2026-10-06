import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { getBook } from "@/modules/library";
import { getSceneForEditor } from "@/modules/manuscript";
import { BinderNav, SceneDetails, SceneEditor, trashSceneAction } from "@/modules/manuscript/ui";
import { RevisionsDialog } from "@/modules/history/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { listParticipants } from "@/modules/participation";
import { SceneParticipants } from "@/modules/participation/ui";
import { getSceneStoryTime } from "@/modules/timeline";
import { SceneStoryTime } from "@/modules/timeline/ui";
import { TaskDialog } from "@/modules/tasks/ui";
import { beatsForScene } from "@/modules/structure";
import { SceneBeats } from "@/modules/structure/ui";
import { draftOwner } from "@/lib/local-drafts";
import { requireAuthorContext } from "@/server/context";
import { can } from "@/server/policy";
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
  const [book, editor, connections, beats, participants, storyTime] = await Promise.all([
    orNotFound(getBook(ctx, bookId)),
    orNotFound(getSceneForEditor(ctx, sceneId)),
    orNotFound(listConnections(ctx, sceneId)),
    beatsForScene(ctx, sceneId),
    orNotFound(listParticipants(ctx, sceneId)),
    orNotFound(getSceneStoryTime(ctx, sceneId)),
  ]);
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
        <div className="flex justify-end">
          <FieldHistoryDialog nodeId={scene.id} title="Earlier synopses" />
        </div>
        <SceneBeats beats={beats} />
        <SceneParticipants
          sceneId={scene.id}
          canEdit={can(ctx, "edit", "manuscript")}
          participants={participants.map((p) => ({
            characterId: p.character.id,
            name: p.character.title,
            href: p.character.href,
            presence: p.presence,
            pov: p.pov,
          }))}
        />
        <SceneStoryTime
          sceneId={scene.id}
          sceneTitle={scene.title}
          placed={storyTime.placed}
          label={storyTime.label}
          order={storyTime.order}
          timelineHref={storyTime.timeline.owner.href}
          choices={storyTime.timeline.entries}
          canEdit={can(ctx, "edit", "manuscript")}
        />
        <SceneEditor
          key={scene.id}
          sceneId={scene.id}
          content={scene.content}
          version={scene.version}
          wordCount={scene.wordCount}
          draftOwner={draftOwner(ctx)}
          draftLabel={`${scene.title} · ${book.title}`}
          href={`/books/${bookId}/scenes/${scene.id}`}
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
              emptyText="Notes, research, relationship moments and other links for this scene."
              actions={
                <div className="flex flex-wrap gap-2">
                  <NewNoteDialog
                    about={{ id: scene.id, title: scene.title }}
                    trigger={
                      <Button variant="outline" size="sm">
                        New note
                      </Button>
                    }
                  />
                  <TaskDialog
                    concerns={{ id: scene.id, title: scene.title }}
                    trigger={
                      <Button variant="outline" size="sm">
                        New task
                      </Button>
                    }
                  />
                </div>
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
