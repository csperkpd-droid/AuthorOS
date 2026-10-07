"use client";

import {
  ArrowRightLeft,
  BookPlus,
  FilePlus,
  FolderInput,
  FolderOutput,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormError } from "@/components/ui/field";
import { SortableList } from "@/components/ui/sortable-list";
import { formatWords } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  addChapterAction,
  addPartAction,
  addSceneAction,
  dissolvePartAction,
  previewDissolvePartAction,
  moveChapterAction,
  movePartAction,
  moveSceneAction,
  renameChapterAction,
  renamePartAction,
  trashChapterAction,
  trashPartAction,
  trashSceneAction,
} from "../actions";
import { ImpactDialog } from "@/modules/impact/ui";

import { SCENE_STATUS_LABELS } from "../labels";
import type { BookLevelItem, ChapterItem, PartItem, SceneItem } from "../structure";
import { InlineTitleInput } from "./inline-title";
import { MoveDialog, type MoveTarget } from "./move-dialog";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The book's structure editor: optional parts, chapters and scenes. Drag
 * (or use the keyboard) to reorder within a list; "Move to…" moves between
 * chapters or parts.
 */
export function BinderManager({ bookId, items }: { bookId: string; items: BookLevelItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  // Removing a part is reviewed first (Change Impact).
  const [dissolving, setDissolving] = useState<string | null>(null);

  /** Runs an action and surfaces its error in the binder. */
  async function act(promise: Promise<Result>) {
    setError(null);
    const result = await promise;
    if (!result.ok) setError(result.error);
    return result;
  }

  const shared: Shared = {
    bookId,
    act,
    renaming,
    setRenaming,
    setMoveTarget,
    setDissolving,
  };

  return (
    <section aria-labelledby="binder-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="binder-heading" className="text-lg font-semibold">
          Manuscript
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => act(addPartAction(bookId))}>
            <FolderInput />
            Add part
          </Button>
          <Button size="sm" onClick={() => act(addChapterAction(bookId, null))}>
            <BookPlus />
            Add chapter
          </Button>
        </div>
      </div>
      <FormError message={error} />

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="font-display text-2xl font-semibold">No chapters yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a chapter to start writing. Parts are optional; use them for acts or larger
            sections.
          </p>
        </div>
      ) : (
        <SortableList
          items={items}
          label="Parts and chapters"
          itemLabel={(i) => i.title}
          className="space-y-2"
          onMove={(id, afterId) => {
            const item = items.find((i) => i.id === id)!;
            return act(
              item.kind === "part"
                ? movePartAction(id, afterId)
                : moveChapterAction(id, null, afterId),
            );
          }}
          renderItem={(item, handle) =>
            item.kind === "part" ? (
              <PartBlock part={item} handle={handle} {...shared} />
            ) : (
              <ChapterBlock chapter={item} handle={handle} {...shared} />
            )
          }
        />
      )}

      <ImpactDialog
        open={dissolving !== null}
        onOpenChange={(o) => !o && setDissolving(null)}
        title="Remove this part?"
        loadReport={() => previewDissolvePartAction(dissolving!)}
        onConfirm={(token) => dissolvePartAction(dissolving!, token)}
        confirmLabel="Remove part"
      />
      <MoveDialog
        target={moveTarget}
        items={items}
        onClose={() => setMoveTarget(null)}
        onMoveScene={(id, chapterId, afterId) => act(moveSceneAction(id, chapterId, afterId))}
        onMoveChapter={(id, partId, afterId) => act(moveChapterAction(id, partId, afterId))}
      />
    </section>
  );
}

type Shared = {
  bookId: string;
  act: (p: Promise<Result>) => Promise<Result>;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  setMoveTarget: (t: MoveTarget) => void;
  setDissolving: (partId: string) => void;
};

function PartBlock({ part, handle, ...shared }: { part: PartItem; handle: ReactNode } & Shared) {
  const { bookId, act, renaming, setRenaming, setDissolving } = shared;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-2">
      <Row
        handle={handle}
        title={
          renaming === part.id ? (
            <InlineTitleInput
              initial={part.title}
              label="Part title"
              onSave={(t) => act(renamePartAction(part.id, t))}
              onDone={() => setRenaming(null)}
            />
          ) : (
            <span className="text-lg font-semibold">{part.title}</span>
          )
        }
        meta={formatWords(part.wordCount)}
        menuLabel={`Actions for ${part.title}`}
        menu={
          <>
            <DropdownMenuItem onSelect={() => setRenaming(part.id)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act(addChapterAction(bookId, part.id))}>
              <BookPlus />
              Add chapter
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDissolving(part.id)}>
              <FolderOutput />
              Remove part, keep chapters
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => act(trashPartAction(part.id))}>
              <Trash2 />
              Move to Trash
            </DropdownMenuItem>
          </>
        }
      />
      <div className="mt-1 pl-6">
        {part.chapters.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No chapters in this part.{" "}
            <button
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => act(addChapterAction(bookId, part.id))}
            >
              Add one
            </button>
          </p>
        ) : (
          <SortableList
            items={part.chapters}
            label={`Chapters in ${part.title}`}
            itemLabel={(c) => c.title}
            className="space-y-2"
            onMove={(id, afterId) => act(moveChapterAction(id, part.id, afterId))}
            renderItem={(chapter, chapterHandle) => (
              <ChapterBlock chapter={chapter} handle={chapterHandle} {...shared} />
            )}
          />
        )}
      </div>
    </div>
  );
}

function ChapterBlock({
  chapter,
  handle,
  ...shared
}: { chapter: ChapterItem; handle: ReactNode } & Shared) {
  const { act, renaming, setRenaming, setMoveTarget } = shared;
  const addScene = () => act(addSceneAction(chapter.id));
  return (
    <div className="rounded-lg border border-border bg-surface p-2">
      <Row
        handle={handle}
        title={
          renaming === chapter.id ? (
            <InlineTitleInput
              initial={chapter.title}
              label="Chapter title"
              onSave={(t) => act(renameChapterAction(chapter.id, t))}
              onDone={() => setRenaming(null)}
            />
          ) : (
            <span className="font-medium">{chapter.title}</span>
          )
        }
        meta={formatWords(chapter.wordCount)}
        menuLabel={`Actions for ${chapter.title}`}
        menu={
          <>
            <DropdownMenuItem onSelect={() => setRenaming(chapter.id)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addScene}>
              <FilePlus />
              Add scene
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setMoveTarget({
                  kind: "chapter",
                  id: chapter.id,
                  title: chapter.title,
                  partId: chapter.partId,
                })
              }
            >
              <ArrowRightLeft />
              Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => act(trashChapterAction(chapter.id))}>
              <Trash2 />
              Move to Trash
            </DropdownMenuItem>
          </>
        }
      />
      <div className="pl-6">
        {chapter.scenes.length > 0 && (
          <SortableList
            items={chapter.scenes}
            label={`Scenes in ${chapter.title}`}
            itemLabel={(sc) => sc.title}
            className="mt-1 space-y-0.5"
            onMove={(id, afterId) => act(moveSceneAction(id, chapter.id, afterId))}
            renderItem={(scene, sceneHandle) => (
              <SceneRow scene={scene} chapterId={chapter.id} handle={sceneHandle} {...shared} />
            )}
          />
        )}
        <button
          onClick={addScene}
          className="mt-1 flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
          Add scene
          <span className="sr-only"> to {chapter.title}</span>
        </button>
      </div>
    </div>
  );
}

function SceneRow({
  scene,
  chapterId,
  handle,
  bookId,
  act,
  setMoveTarget,
}: { scene: SceneItem; chapterId: string; handle: ReactNode } & Shared) {
  return (
    <Row
      handle={handle}
      title={
        <Link
          href={`/books/${bookId}/scenes/${scene.id}`}
          className="block truncate hover:text-primary hover:underline"
        >
          {scene.title}
        </Link>
      }
      meta={
        <span className="flex items-center gap-2">
          <Badge>{SCENE_STATUS_LABELS[scene.status as keyof typeof SCENE_STATUS_LABELS]}</Badge>
          {formatWords(scene.wordCount)}
        </span>
      }
      menuLabel={`Actions for ${scene.title}`}
      menu={
        <>
          <DropdownMenuItem
            onSelect={() =>
              setMoveTarget({ kind: "scene", id: scene.id, title: scene.title, chapterId })
            }
          >
            <ArrowRightLeft />
            Move to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => act(trashSceneAction(scene.id))}>
            <Trash2 />
            Move to Trash
          </DropdownMenuItem>
        </>
      }
      compact
    />
  );
}

function Row({
  handle,
  title,
  meta,
  menu,
  menuLabel,
  compact,
}: {
  handle: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  menu: ReactNode;
  menuLabel: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", compact ? "py-0.5" : "py-1")}>
      {handle}
      <div className="min-w-0 flex-1">{title}</div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{meta}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-7 shrink-0 p-0" aria-label={menuLabel}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>{menu}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
