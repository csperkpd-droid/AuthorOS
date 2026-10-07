import { Workflow } from "lucide-react";
import Link from "next/link";

import type { StructureKind } from "@/generated/prisma/enums";

import { STRUCTURE_KIND_LABELS } from "../labels";

type SceneBeat = {
  beatId: string;
  beatTitle: string;
  outlineId: string;
  outlineTitle: string;
  kind: StructureKind;
  seriesWide?: boolean;
  /** Validity of the placement (M14); absent = current. */
  validity?: string;
};

/** The beats a scene carries, across every structure (plot, romance, arcs). */
export function SceneBeats({ beats }: { beats: SceneBeat[] }) {
  if (beats.length === 0) return null;
  return (
    <ul aria-label="Story beats in this scene" className="flex flex-wrap gap-2">
      {beats.map((b) => (
        <li key={b.beatId}>
          <Link
            href={`/structure/${b.outlineId}`}
            title={`${STRUCTURE_KIND_LABELS[b.kind].one}${b.seriesWide ? " (whole series)" : ""}: ${b.outlineTitle}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-0.5 text-xs hover:bg-surface-hover"
          >
            <Workflow className="size-3 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">
              {b.seriesWide
                ? `Series ${STRUCTURE_KIND_LABELS[b.kind].one.toLowerCase()}`
                : STRUCTURE_KIND_LABELS[b.kind].one}
              :
            </span>
            {b.beatTitle}
            {b.validity === "CONFLICTED" && (
              <span className="text-muted-foreground"> · no longer fits</span>
            )}
            {b.validity === "INTENTIONALLY_EXCEPTED" && (
              <span className="text-muted-foreground"> · kept intentionally</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
