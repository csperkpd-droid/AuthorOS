import { CalendarClock, PenLine, Plus, Settings2, Trash2, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { formatDay } from "@/lib/dates";
import { formatCount, formatWords } from "@/lib/format";
import {
  WRITING_STATUS_LABELS,
  getBook,
  HEAT_LEVEL_LABELS,
  listSeriesOptions,
} from "@/modules/library";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { BookDialog, trashBookAction } from "@/modules/library/ui";
import { getBookTree } from "@/modules/manuscript";
import { BinderManager } from "@/modules/manuscript/ui";
import { ChangePenNameDialog } from "@/modules/impact/ui";
import { deadlinesFor } from "@/modules/calendar";
import { listPenNames } from "@/modules/pen-names";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { TaskDialog } from "@/modules/tasks/ui";
import { listKits, listOutlines, newStructureOptions } from "@/modules/structure";
import {
  ApplyKitDialog,
  NewStructureDialog,
  OutlineList,
  SaveKitDialog,
} from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

export async function generateMetadata({
  params,
}: PageProps<"/books/[bookId]">): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const book = await orNotFound(getBook(ctx, (await params).bookId));
  return { title: book.title };
}

export default async function BookPage({ params }: PageProps<"/books/[bookId]">) {
  const { bookId } = await params;
  const ctx = await requireAuthorContext();
  const found = await orNotFound(getBook(ctx, bookId));
  // The deadline lives on the calendar (one source of truth for dates).
  const book = { ...found, dueOn: (await deadlinesFor(ctx, [bookId])).get(bookId) ?? null };
  const [tree, penNames, seriesOptions, connections, outlines, structureOptions, kits] =
    await Promise.all([
      orNotFound(getBookTree(ctx, bookId)),
      listPenNames(ctx),
      listSeriesOptions(ctx),
      orNotFound(listConnections(ctx, bookId)),
      listOutlines(ctx, { bookId }),
      newStructureOptions(ctx, { penNameId: book.penName.id }),
      listKits(ctx),
    ]);
  const firstScene = tree.sceneOrder[0];

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/library" className="hover:text-foreground">
          Library
        </Link>
        {book.series && (
          <>
            {" › "}
            <Link href={`/library/series/${book.series.id}`} className="hover:text-foreground">
              {book.series.title}
            </Link>
          </>
        )}
      </nav>

      <PageHeader
        title={book.title}
        description={book.subtitle ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={book.id} />
            <BookDialog
              book={book}
              penNames={penNames.map((p) => ({ id: p.id, name: p.name }))}
              seriesOptions={seriesOptions}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            {!book.seriesId && (
              <ChangePenNameDialog
                kind="BOOK"
                id={book.id}
                title={book.title}
                currentPenNameId={book.penName.id}
                penNames={penNames
                  .filter((p) => !p.archivedAt)
                  .map((p) => ({ id: p.id, name: p.name }))}
                trigger={
                  <Button variant="outline">
                    <UserRound />
                    Change pen name…
                  </Button>
                }
              />
            )}
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move book to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${book.title}” to the Trash?`}
              description="The book and its manuscript will be hidden until you restore it from the Trash."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashBookAction.bind(null, book.id)}
              navigateTo="/library"
            />
            {firstScene && (
              <Link href={`/books/${book.id}/scenes/${firstScene.id}`} className={buttonVariants()}>
                <PenLine />
                Write
              </Link>
            )}
          </div>
        }
      />

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pen name">
          {book.penName.name}
          {book.penName.archivedAt && <Badge className="ml-2">Archived</Badge>}
        </Stat>
        <Stat label="Writing status">{WRITING_STATUS_LABELS[book.writingStatus]}</Stat>
        <Stat label="Words">
          <span>
            {formatWords(tree.wordCount)}
            {book.targetWordCount ? ` of ${book.targetWordCount.toLocaleString("en-US")}` : ""}
          </span>
          {book.targetWordCount ? (
            <div className="mt-2">
              <Progress
                value={(tree.wordCount / book.targetWordCount) * 100}
                label="Progress toward target"
              />
            </div>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatCount(tree.sceneCount, "scene")}
          </span>
          {book.dueOn && (
            <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden />
              Due{" "}
              {formatDay(book.dueOn, {
                weekday: undefined,
                year: "numeric",
              })}
            </span>
          )}
        </Stat>
      </dl>
      {book.description && <p className="max-w-prose text-muted-foreground">{book.description}</p>}
      {(book.tropes.length > 0 || book.heatLevel) && (
        <ul aria-label="Tropes and heat level" className="flex flex-wrap gap-2">
          {book.heatLevel && (
            <li>
              <Badge className="bg-primary/10 text-primary">
                {HEAT_LEVEL_LABELS[book.heatLevel]}
              </Badge>
            </li>
          )}
          {book.tropes.map((t) => (
            <li key={t}>
              <Badge>{t}</Badge>
            </li>
          ))}
        </ul>
      )}

      <BinderManager bookId={book.id} items={tree.items} />

      <section aria-labelledby="structures-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="structures-heading" className="font-serif text-xl">
            Structures
          </h2>
          <div className="flex flex-wrap gap-2">
            {outlines.some((o) => o.book?.id === book.id) && (
              <SaveKitDialog target={{ bookId: book.id }} defaultName={`${book.title} kit`} />
            )}
            <ApplyKitDialog
              kits={kits}
              target={{ bookId: book.id }}
              relationships={structureOptions.relationships}
              characters={structureOptions.characters}
            />
            <NewStructureDialog
              {...structureOptions}
              books={[{ id: book.id, label: book.title }]}
              series={book.series ? [{ id: book.series.id, label: book.series.title }] : []}
              defaults={{ bookId: book.id }}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus />
                  New structure
                </Button>
              }
            />
          </div>
        </div>
        {outlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Map a plot beat sheet, romance arc or character arc onto this book’s scenes.
          </p>
        ) : (
          <OutlineList outlines={outlines} />
        )}
      </section>

      <ConnectionsPanel
        nodeId={book.id}
        nodeKind="BOOK"
        connections={connections}
        heading="Notes & links"
        emptyText="Notes, research, ideas and other links for this book."
        actions={
          <div className="flex flex-wrap gap-2">
            <NewNoteDialog
              about={{ id: book.id, title: book.title }}
              trigger={
                <Button variant="outline" size="sm">
                  New note
                </Button>
              }
            />
            <TaskDialog
              concerns={{ id: book.id, title: book.title }}
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
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
