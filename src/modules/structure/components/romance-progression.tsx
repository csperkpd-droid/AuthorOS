import { CircleCheck, CircleDashed, Heart } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { ArcRole } from "@/generated/prisma/enums";

import { ARC_ROLE_LABELS } from "../labels";

type Cell = { beatId: string; title: string; outlineId: string; placed: boolean };
type Row = {
  relationship: {
    id: string;
    type: string;
    members: { id: string; name: string; role: string | null }[];
    title: string;
  };
  arcRole: ArcRole;
  arcs: { id: string; title: string; seriesWide: boolean; bookId: string | null }[];
  books: { bookId: string; beats: Cell[] }[];
  unplanned: Cell[];
};

/**
 * The Series Romance Center: every romance in a series (main and secondary
 * couples, triangles, Why Choose groups), each
 * shown as its progression book by book. A beat appears under the books its
 * scenes are in, or else the book it is planned for.
 */
export function RomanceProgression({
  books,
  relationships,
}: {
  books: { id: string; title: string; number: number }[];
  relationships: Row[];
}) {
  return (
    <div className="space-y-6">
      {relationships.map((r) => {
        const couple = r.relationship.title;
        return (
          <section
            key={r.relationship.id}
            aria-label={couple}
            className="space-y-3 rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Heart className="size-4 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">
                <Link href={`/relationships/${r.relationship.id}`} className="hover:underline">
                  {couple}
                </Link>
              </h2>
              <Badge className={r.arcRole === "MAIN" ? "bg-secondary text-primary" : undefined}>
                {ARC_ROLE_LABELS[r.arcRole]}
              </Badge>
            </div>
            {r.relationship.members.some((m) => m.role) && (
              <ul
                aria-label={`Roles in ${couple}`}
                className="flex flex-wrap gap-x-3 gap-y-1 text-sm"
              >
                {r.relationship.members.map((m) => (
                  <li key={m.id}>
                    <Link href={`/characters/${m.id}`} className="hover:underline">
                      {m.name}
                    </Link>
                    {m.role && <span className="text-muted-foreground"> · {m.role}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {r.arcs.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && " · "}
                  <Link
                    href={`/structure/${a.id}`}
                    className="hover:text-foreground hover:underline"
                  >
                    {a.title}
                  </Link>
                  {a.seriesWide ? " (whole series)" : ""}
                </span>
              ))}
            </p>
            <ol
              aria-label={`${couple} across the series`}
              className="grid [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))] gap-3"
            >
              {r.books.map((cell) => {
                const book = books.find((b) => b.id === cell.bookId)!;
                return (
                  <li key={cell.bookId} className="space-y-2 rounded-lg bg-muted/40 p-3">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Book {book.number}
                    </p>
                    <p className="truncate font-medium">{book.title}</p>
                    {cell.beats.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <ul aria-label={`${couple} in ${book.title}`} className="space-y-1 text-sm">
                        {cell.beats.map((b) => (
                          <li
                            key={`${b.beatId}-${cell.bookId}`}
                            className="flex items-start gap-1.5"
                          >
                            {b.placed ? (
                              <CircleCheck
                                className="mt-0.5 size-3.5 shrink-0 text-primary"
                                aria-label="Placed in a scene"
                              />
                            ) : (
                              <CircleDashed
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                aria-label="Planned"
                              />
                            )}
                            <Link href={`/structure/${b.outlineId}`} className="hover:underline">
                              {b.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
            {r.unplanned.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Not yet planned for a book: {r.unplanned.map((b) => b.title).join(", ")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
