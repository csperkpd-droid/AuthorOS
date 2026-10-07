"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Pen = { id: string; name: string };
type Book = { id: string; title: string; penNameId: string; seriesTitle: string | null };

const FORMATS = [
  {
    value: "docx",
    label: "Word manuscript (.docx)",
    hint: "Standard manuscript format: 12 pt, double-spaced, a chapter per page, # between scenes.",
  },
  {
    value: "markdown",
    label: "Markdown manuscript (.md)",
    hint: "Plain text with headings, for other writing tools and version control.",
  },
  {
    value: "json",
    label: "Standard backup (.json)",
    hint: "All your story data, structured: every story object with its id, hierarchy, identities, relationships, connections, structures and beat placements, custom fields. Can be imported back.",
  },
  {
    value: "archive",
    label: "Complete archive (.json)",
    hint: "The standard backup plus version history: every saved version of your scenes and notes. Larger.",
  },
] as const;

/**
 * The export wizard: what to include (current pen name, chosen pen names or
 * the entire workspace), the format, and for manuscripts which books. The
 * download is a plain GET, so the browser saves the file. Exports are
 * read-only.
 */
export function ExportWizard({
  penNames,
  activePenNameId,
  books,
}: {
  penNames: Pen[];
  activePenNameId: string | null;
  books: Book[];
}) {
  const active = penNames.find((p) => p.id === activePenNameId);
  const [scope, setScope] = useState<"current" | "selected" | "all">(active ? "current" : "all");
  const [pens, setPens] = useState<string[]>(active ? [active.id] : []);
  const [format, setFormat] = useState<(typeof FORMATS)[number]["value"]>("docx");
  const scopePens =
    scope === "current" ? (active ? [active.id] : []) : scope === "selected" ? pens : null;
  const inScope = books.filter((b) => !scopePens || scopePens.includes(b.penNameId));
  const [excluded, setExcluded] = useState<string[]>([]);
  const manuscript = format === "docx" || format === "markdown";
  const chosenBooks = inScope.filter((b) => !excluded.includes(b.id));
  const ready =
    (scope !== "selected" || pens.length > 0) &&
    (scope !== "current" || active) &&
    (!manuscript || chosenBooks.length > 0);

  return (
    <form action="/export/download" method="get" className="space-y-8">
      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">1. What to include</legend>
        {[
          {
            value: "current" as const,
            label: active ? `Current pen name: ${active.name}` : "Current pen name",
            hint: active ? undefined : "You’re writing as all identities.",
            disabled: !active,
          },
          { value: "selected" as const, label: "Selected pen names" },
          { value: "all" as const, label: "Entire workspace" },
        ].map((o) => (
          <label
            key={o.value}
            className={cn("flex items-start gap-2 text-sm", o.disabled && "opacity-50")}
          >
            <input
              type="radio"
              name="scope"
              value={o.value}
              checked={scope === o.value}
              disabled={o.disabled}
              onChange={() => setScope(o.value)}
              className="mt-1"
            />
            <span>
              {o.label}
              {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </label>
        ))}
        {scope === "selected" && (
          <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
            {penNames.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="pen"
                  value={p.id}
                  checked={pens.includes(p.id)}
                  onChange={(e) =>
                    setPens((list) =>
                      e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Notes, ideas, tasks and events are shared: a pen-name export includes those not linked
          only to other pen names.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">2. Format</legend>
        {FORMATS.map((f) => (
          <label key={f.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={f.value === "archive" ? undefined : "format"}
              value={f.value}
              checked={format === f.value}
              onChange={() => setFormat(f.value)}
              className="mt-1"
            />
            <span>
              {f.label}
              <span className="block text-xs text-muted-foreground">{f.hint}</span>
            </span>
          </label>
        ))}
        {/* Both JSON options use format=json; "kind" picks standard or archive. */}
        {(format === "json" || format === "archive") && (
          <input type="hidden" name="kind" value={format === "archive" ? "archive" : "standard"} />
        )}
      </fieldset>

      {manuscript && (
        <fieldset className="space-y-2">
          <legend className="text-lg font-semibold">3. Books</legend>
          {inScope.length === 0 ? (
            <p className="text-sm text-muted-foreground">No books in this selection.</p>
          ) : (
            <div className="space-y-1">
              {inScope.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="book"
                    value={b.id}
                    checked={!excluded.includes(b.id)}
                    onChange={(e) =>
                      setExcluded((list) =>
                        e.target.checked ? list.filter((x) => x !== b.id) : [...list, b.id],
                      )
                    }
                  />
                  {b.title}
                  {b.seriesTitle && (
                    <span className="text-muted-foreground">· {b.seriesTitle}</span>
                  )}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Several books export into one file, each starting on a new page. Items in the Trash are
            left out.
          </p>
        </fieldset>
      )}

      {format === "archive" && <input type="hidden" name="format" value="json" />}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button type="submit" disabled={!ready}>
          <Download />
          Download
        </Button>
        <p className="text-xs text-muted-foreground">
          Exporting never changes your manuscript or your story data.
        </p>
      </div>
    </form>
  );
}
