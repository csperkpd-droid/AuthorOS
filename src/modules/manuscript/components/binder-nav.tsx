"use client";

import { List } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { BookLevelItem, ChapterItem } from "../structure";

/** Read-only contents for the editor: jump between scenes. */
export function BinderNav({
  bookId,
  bookTitle,
  items,
  currentSceneId,
}: {
  bookId: string;
  bookTitle: string;
  items: BookLevelItem[];
  currentSceneId: string;
}) {
  const [open, setOpen] = useState(false);

  const tree = (
    <nav aria-label="Contents" className="space-y-3 text-sm">
      <Link href={`/books/${bookId}`} className="block font-serif text-base hover:text-primary">
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
  onNavigate,
}: {
  chapter: ChapterItem;
  bookId: string;
  currentSceneId: string;
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
                "block truncate rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                s.id === currentSceneId && "bg-primary/10 font-medium text-primary",
              )}
            >
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
