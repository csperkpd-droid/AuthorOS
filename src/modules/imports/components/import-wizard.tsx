"use client";

import { CheckCircle2, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { formatCount, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ImportResult, ImportReview } from "../service";
import { IMPORT_SOURCES } from "../sources/catalog";

type Options = { ids: "keep" | "new"; existing: "skip" | "replace" };

/** Gzips the file in the browser when it can (backups compress very well). */
async function body(file: File): Promise<{ data: Blob; type: string }> {
  if (typeof CompressionStream === "undefined") return { data: file, type: "application/json" };
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  return { data: await new Response(stream).blob(), type: "application/gzip" };
}

async function post<T>(path: string, file: File, params: Record<string, string>) {
  const { data, type } = await body(file);
  const response = await fetch(`${path}?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: data,
  });
  const json = (await response.json().catch(() => null)) as
    (T & { error?: undefined }) | { error: string; problems?: string[] } | null;
  if (!response.ok || !json || json.error !== undefined) {
    const message = json && "error" in json && json.error ? json.error : "Something went wrong.";
    throw new Error(message);
  }
  return json as T;
}

/**
 * The import wizard: source, file, options, then a review of exactly what
 * will be created, updated, skipped or conflict, and only then the import
 * itself (all or nothing). Changing the file or an option discards the
 * review.
 */
export function ImportWizard() {
  const id = useId();
  const router = useRouter();
  const [source, setSource] = useState("authoros-json");
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Options>({ ids: "keep", existing: "skip" });
  const [review, setReview] = useState<ImportReview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<"review" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReview(null);
    setResult(null);
    setError(null);
  };
  const choose = (next: Partial<Options>) => {
    setOptions((o) => ({ ...o, ...next }));
    reset();
  };
  const params = (extra: Record<string, string> = {}) => ({
    source,
    filename: file?.name ?? "import",
    ...options,
    ...extra,
  });

  async function runReview() {
    if (!file) return;
    setPending("review");
    setError(null);
    setResult(null);
    try {
      setReview(await post<ImportReview>("/api/import/review", file, params()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function runImport() {
    if (!file || !review?.token) return;
    setPending("import");
    setError(null);
    try {
      setResult(
        await post<ImportResult>("/api/import/apply", file, params({ token: review.token })),
      );
      setReview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const sourceInfo = IMPORT_SOURCES.find((s) => s.id === source)!;

  return (
    <div className="space-y-8">
      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">1. Source</legend>
        {IMPORT_SOURCES.map((s) => (
          <label
            key={s.id}
            className={cn("flex items-start gap-2 text-sm", !s.available && "opacity-60")}
          >
            <input
              type="radio"
              name="source"
              value={s.id}
              checked={source === s.id}
              disabled={!s.available}
              onChange={() => {
                setSource(s.id);
                reset();
              }}
              className="mt-1"
            />
            <span>
              {s.label}
              {!s.available && <Badge className="ml-2">Coming later</Badge>}
              <span className="block text-xs text-muted-foreground">{s.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">2. File</legend>
        <label
          htmlFor={`${id}-file`}
          className="flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm hover:bg-surface-hover/40"
        >
          <FileUp className="size-5 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            {file ? (
              <>
                <span className="font-medium break-all">{file.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatCount(Math.max(1, Math.round(file.size / 1024)), "KB", "KB")}
                </span>
              </>
            ) : (
              <>Choose a backup file ({sourceInfo.extensions.join(", ")})</>
            )}
          </span>
        </label>
        <input
          id={`${id}-file`}
          type="file"
          aria-label="Backup file"
          accept={sourceInfo.extensions.join(",")}
          className="sr-only"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            reset();
          }}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-lg font-semibold">3. Options</legend>
        <div className="space-y-2">
          <p className="text-sm font-medium">Ids</p>
          {[
            {
              value: "keep" as const,
              label: "Restore (keep the original ids)",
              hint: "For restoring a backup, or moving a workspace to a new account or installation. Links to these objects keep working.",
            },
            {
              value: "new" as const,
              label: "Import as a copy (new ids)",
              hint: "Everything is created anew, alongside what’s here. Use it to duplicate a workspace, or when the ids are already used elsewhere.",
            },
          ].map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="ids"
                checked={options.ids === o.value}
                onChange={() => choose({ ids: o.value })}
                className="mt-1"
              />
              <span>
                {o.label}
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {options.ids === "keep" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Objects that already exist here</p>
            {[
              {
                value: "skip" as const,
                label: "Keep them as they are",
                hint: "Only what’s missing is restored.",
              },
              {
                value: "replace" as const,
                label: "Replace them with the file’s version",
                hint: "Current scene and note text is saved as a version first, so you can go back.",
              },
            ].map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="existing"
                  checked={options.existing === o.value}
                  onChange={() => choose({ existing: o.value })}
                  className="mt-1"
                />
                <span>
                  {o.label}
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button onClick={runReview} disabled={!file || pending !== null}>
          {pending === "review" ? "Checking the file…" : "Review import"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Reviewing reads the whole file and changes nothing.
        </p>
      </div>

      <FormError message={error ?? undefined} />

      {review && <ReviewPanel review={review} />}

      {review?.canImport && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runImport} disabled={pending !== null}>
            <Upload />
            {pending === "import" ? "Importing…" : "Import"}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={pending !== null}>
            Cancel
          </Button>
          <p className="text-xs text-muted-foreground">Everything is imported, or nothing is.</p>
        </div>
      )}

      {result && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <CheckCircle2 className="mt-0.5 size-5 text-primary" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Import complete</p>
            <p className="text-muted-foreground">
              {formatCount(result.created, "item")} created, {formatCount(result.updated, "item")}{" "}
              updated, {formatCount(result.skipped, "item")} already here.
            </p>
            <Link href="/library" className="text-primary underline-offset-4 hover:underline">
              Go to the Library
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ review }: { review: ImportReview }) {
  return (
    <section
      aria-label="Import review"
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      {review.file && (
        <p className="text-sm text-muted-foreground">
          {review.file.description}
          {review.file.scopeLabel && <> · {review.file.scopeLabel}</>}
          {review.file.exportedAt && (
            <> · exported {formatDateTime(new Date(review.file.exportedAt))}</>
          )}
        </p>
      )}
      <p className="font-medium">{review.summary}</p>

      {review.errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Problems found in the file</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
            {review.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {review.counts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-normal">What</th>
                <th className="py-1 pr-4 text-right font-normal">Create</th>
                <th className="py-1 pr-4 text-right font-normal">Update</th>
                <th className="py-1 text-right font-normal">Already here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {review.counts.map((c) => (
                <tr key={c.key}>
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {c.label}
                  </th>
                  <td className="py-1 pr-4 text-right tabular-nums">{c.create || "–"}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{c.update || "–"}</td>
                  <td className="py-1 text-right tabular-nums">{c.skip || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {review.conflicts.map((c) => (
        <div key={c.key} className="space-y-1 rounded-lg border border-destructive/40 p-3">
          <p className="text-sm font-medium">
            {c.title} ({c.items.length})
          </p>
          <p className="text-xs text-muted-foreground">{c.detail}</p>
          <ul className="list-disc pl-5 text-sm">
            {c.items.slice(0, 10).map((item) => (
              <li key={item}>{item}</li>
            ))}
            {c.items.length > 10 && <li>and {formatCount(c.items.length - 10, "more", "more")}</li>}
          </ul>
        </div>
      ))}

      {review.adjustments.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Good to know</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {review.adjustments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
