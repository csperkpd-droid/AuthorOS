import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { StructureKind } from "@/generated/prisma/enums";

import { STRUCTURE_KIND_LABELS } from "../labels";

type Outline = {
  id: string;
  kind: StructureKind;
  title: string;
  beatCount: number;
  placedCount: number;
  book: { title: string };
};

/** Structures with how many beats are placed in scenes. */
export function OutlineList({
  outlines,
  showBook = false,
}: {
  outlines: Outline[];
  showBook?: boolean;
}) {
  return (
    <ul
      aria-label="Structures"
      className="divide-y divide-border rounded-xl border border-border bg-surface"
    >
      {outlines.map((o) => (
        <li key={o.id}>
          <Link
            href={`/structure/${o.id}`}
            className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/50"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{o.title}</p>
              <p className="text-xs text-muted-foreground">
                {STRUCTURE_KIND_LABELS[o.kind].one}
                {showBook && ` · ${o.book.title}`}
              </p>
            </div>
            <div className="w-40 space-y-1">
              <p className="text-right text-xs text-muted-foreground">
                {o.placedCount} of {o.beatCount} beats placed
              </p>
              <Progress
                value={o.beatCount ? (o.placedCount / o.beatCount) * 100 : 0}
                label={`${o.title}: beats placed`}
              />
            </div>
            <Badge className="sr-only">{o.kind}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
