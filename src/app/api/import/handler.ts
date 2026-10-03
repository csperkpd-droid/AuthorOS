import { ZodError } from "zod";

import { DomainError } from "@/lib/errors";
import { ImportFileError, isSameOrigin, readUpload, type ImportFile } from "@/modules/imports";
import { getSessionUser, requireAuthorContext, type AuthorContext } from "@/server/context";

/**
 * Shared transport for the import endpoints: same-origin check, session,
 * the uploaded file (body) and options (query). Under /api so the proxy
 * doesn't buffer the upload; authorization happens here, per request.
 */
export async function handleImport(
  request: Request,
  run: (ctx: AuthorContext, file: ImportFile, params: URLSearchParams) => Promise<unknown>,
) {
  if (!isSameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  if (!(await getSessionUser())) return json({ error: "Sign in to import." }, 401);
  const ctx = await requireAuthorContext();
  const params = new URL(request.url).searchParams;
  try {
    const bytes = await readUpload(request);
    const file = {
      sourceId: params.get("source") ?? "authoros-json",
      filename: params.get("filename") ?? "import",
      bytes,
    };
    return json(await run(ctx, file, params));
  } catch (error) {
    if (error instanceof ImportFileError)
      return json({ error: error.message, problems: error.problems }, 400);
    if (error instanceof DomainError)
      return json(
        { error: error.message },
        error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : 400,
      );
    if (error instanceof ZodError) return json({ error: "Check the import options." }, 400);
    throw error;
  }
}

export const importOptionsFrom = (params: URLSearchParams) => ({
  ids: params.get("ids") === "new" ? ("new" as const) : ("keep" as const),
  existing: params.get("existing") === "replace" ? ("replace" as const) : ("skip" as const),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
