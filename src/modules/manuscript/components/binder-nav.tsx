"use client";

import { List } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { ReviewBadge } from "./review-badge";
import type { BookLevelItem, ChapterItem } from "../structure";

/** Read-only contents for the editor: jump between scenes. */
export function BinderNav({
  bookId,
  bookTitle,
  items,
  currentSceneId,
  reviewCounts = {},
}: {
  bookId: string;
  bookTitle: string;
  items: BookLevelItem[];
  currentSceneId: string;
  /** Comments needing review, per scene (M16). */
  reviewCounts?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);

  const tree = (
    <nav aria-label="Contents" className="space-y-3 text-sm">
      <Link href={`/books/${bookId}`} className="block text-base font-semibold hover:text-primary">
        {bookTitle}
      </Link>
      <ul className="space-y-3">
        {items.map((item) =>
          item.kind === "part" ? (
            <li key={item.id}>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {item.title}
              </p>
              <ul className="mt-1 space-y-3 border-l border-border pl-3">
                {item.chapters.map((c) => (
                  <ChapterNav
                    key={c.id}
                    chapter={c}
                    bookId={bookId}
                    currentSceneId={currentSceneId}
                    reviewCounts={reviewCounts}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            </li>
          ) : (
            <ChapterNav
              key={item.id}
              chapter={item}
              bookId={bookId}
              currentSceneId={currentSceneId}
              reviewCounts={reviewCounts}
              onNavigate={() => setOpen(false)}
            />
          ),
        )}
      </ul>
    </nav>
  );

  return (
    <>
      <div className="lg:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          <List className="size-4" aria-hidden />
          Contents
        </button>
        {open && <div className="mt-3 rounded-lg border border-border bg-surface p-4">{tree}</div>}
      </div>
      <div className="hidden lg:block">{tree}</div>
    </>
  );
}

function ChapterNav({
  chapter,
  bookId,
  currentSceneId,
  reviewCounts,
  onNavigate,
}: {
  chapter: ChapterItem;
  bookId: string;
  currentSceneId: string;
  reviewCounts: Record<string, number>;
  onNavigate: () => void;
}) {
  return (
    <li>
      <p className="font-medium">{chapter.title}</p>
      <ul className="mt-1 space-y-0.5">
        {chapter.scenes.map((s) => (
          <li key={s.id}>
            <Link
              href={`/books/${bookId}/scenes/${s.id}`}
              onClick={onNavigate}
              aria-current={s.id === currentSceneId ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                s.id === currentSceneId && "bg-secondary font-medium text-primary",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <ReviewBadge count={reviewCounts[s.id]} />
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
