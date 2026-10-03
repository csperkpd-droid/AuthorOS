import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { WritingStatus } from "@/generated/prisma/enums";
import { formatWords } from "@/lib/format";

import { WRITING_STATUS_LABELS } from "../labels";

export function BookCard({
  book,
  showPenName,
}: {
  book: {
    id: string;
    title: string;
    subtitle: string | null;
    writingStatus: WritingStatus;
    wordCount: number;
    targetWordCount: number | null;
    penName: { name: string; archivedAt: Date | null };
  };
  showPenName?: boolean;
}) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <p className="font-serif text-lg leading-snug">{book.title}</p>
        {book.subtitle && <p className="text-sm text-muted-foreground">{book.subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{WRITING_STATUS_LABELS[book.writingStatus]}</Badge>
        {showPenName && (
          <Badge className="bg-primary/10 text-primary">
            {book.penName.name}
            {book.penName.archivedAt && " (archived)"}
          </Badge>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {formatWords(book.wordCount)}
          {book.targetWordCount ? ` of ${book.targetWordCount.toLocaleString("en-US")}` : ""}
        </p>
        {book.targetWordCount ? (
          <Progress
            value={(book.wordCount / book.targetWordCount) * 100}
            label={`${book.title} progress toward target`}
          />
        ) : null}
      </div>
    </Link>
  );
}
