"use client";

import { SortableList } from "@/components/ui/sortable-list";
import { useAction } from "@/hooks/use-action";
import type { BookStatus } from "@/generated/prisma/enums";
import { FormError } from "@/components/ui/field";

import { moveBookInSeriesAction } from "../actions";
import { BookCard } from "./book-card";

type Book = {
  id: string;
  title: string;
  subtitle: string | null;
  status: BookStatus;
  wordCount: number;
  targetWordCount: number | null;
  penName: { name: string; archivedAt: Date | null };
};

/** The books of a series in reading order; drag to reorder. */
export function SeriesBookOrder({ books, seriesTitle }: { books: Book[]; seriesTitle: string }) {
  const move = useAction(moveBookInSeriesAction);
  return (
    <div className="space-y-2">
      <SortableList
        items={books}
        label={`Books in ${seriesTitle}`}
        itemLabel={(b) => b.title}
        onMove={(id, afterId) => move.run(id, afterId)}
        className="space-y-3"
        renderItem={(book, handle) => (
          <div className="flex items-stretch gap-2">
            <div className="flex flex-col items-center gap-1 pt-4">
              {handle}
              <span className="text-xs text-muted-foreground" aria-hidden>
                #{books.findIndex((b) => b.id === book.id) + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <BookCard book={book} />
            </div>
          </div>
        )}
      />
      <FormError message={move.error} />
    </div>
  );
}
