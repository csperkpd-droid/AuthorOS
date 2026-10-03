import "server-only";

import { NotFoundError, RuleError } from "@/lib/errors";
import { listLibrary } from "@/modules/library";
import { listPenNames } from "@/modules/pen-names";
import type { AuthorContext } from "@/server/context";

import { exportScopeInput, type ExportScopeInput } from "./schemas";

export type ResolvedScope = {
  /** null = the entire workspace. */
  penNameIds: string[] | null;
  label: string;
  slug: string;
};

/** Which identities an export covers: the current pen name, chosen ones, or everything. */
export async function resolveScope(
  ctx: AuthorContext,
  input: ExportScopeInput,
): Promise<ResolvedScope> {
  const scope = exportScopeInput.parse(input);
  const penNames = await listPenNames(ctx, { includeArchived: true });
  const byId = new Map(penNames.map((p) => [p.id, p]));
  if (scope.kind === "all")
    return { penNameIds: null, label: "Entire workspace", slug: "workspace" };
  const ids =
    scope.kind === "current"
      ? ctx.activePenNameId
        ? [ctx.activePenNameId]
        : []
      : scope.penNameIds;
  if (ids.length === 0) {
    throw new RuleError(
      scope.kind === "current"
        ? "You’re writing as all identities. Choose pen names, or export the entire workspace."
        : "Choose at least one pen name.",
    );
  }
  for (const id of ids) if (!byId.has(id)) throw new NotFoundError("Pen name");
  const names = ids.map((id) => byId.get(id)!.name);
  return {
    penNameIds: ids,
    label: names.join(", "),
    slug:
      names
        .join("-")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "export",
  };
}

/** Visible books in scope, in library order (series in reading order, then standalone). */
export async function booksInScope(ctx: AuthorContext, scope: ResolvedScope) {
  const ids = scope.penNameIds;
  const library = await listLibrary(ctx, { penNameId: null });
  const inScope = (b: { penName: { id: string } }) => !ids || ids.includes(b.penName.id);
  return [
    ...library.series.flatMap((s) =>
      s.books.filter(inScope).map((b) => ({ ...b, seriesTitle: s.title as string | null })),
    ),
    ...library.standalone
      .filter(inScope)
      .map((b) => ({ ...b, seriesTitle: null as string | null })),
  ];
}
