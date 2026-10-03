import { ZodError } from "zod";

import { DomainError } from "@/lib/errors";
import {
  exportDocx,
  exportMarkdown,
  exportWorkspaceJson,
  type ExportScopeInput,
} from "@/modules/exports";
import { requireAuthorContext } from "@/server/context";

/**
 * Downloads an export. Read-only: exports never change the manuscript or
 * the Story Graph.
 *
 * ?format=docx|markdown|json&scope=current|selected|all&pen=<id>…&book=<id>…&kind=standard|archive
 */
export async function GET(request: Request) {
  const ctx = await requireAuthorContext();
  const params = new URL(request.url).searchParams;
  const scopeKind = params.get("scope") ?? "all";
  const scope: ExportScopeInput =
    scopeKind === "selected"
      ? { kind: "selected", penNameIds: params.getAll("pen") }
      : scopeKind === "current"
        ? { kind: "current" }
        : { kind: "all" };
  const bookIds = params.getAll("book");

  try {
    switch (params.get("format")) {
      case "docx": {
        const { filename, buffer } = await exportDocx(ctx, { scope, bookIds });
        return download(
          new Uint8Array(buffer),
          filename,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
      }
      case "markdown": {
        const { filename, content } = await exportMarkdown(ctx, { scope, bookIds });
        return download(content, filename, "text/markdown; charset=utf-8");
      }
      case "json": {
        const { filename, data } = await exportWorkspaceJson(ctx, {
          scope,
          kind: params.get("kind") === "archive" ? "archive" : "standard",
        });
        return download(JSON.stringify(data, null, 2), filename, "application/json; charset=utf-8");
      }
      default:
        return new Response("Choose a format: docx, markdown or json.", { status: 400 });
    }
  } catch (error) {
    if (error instanceof DomainError || error instanceof ZodError) {
      const message =
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Check the export options.")
          : error.message;
      return new Response(message, {
        status: error instanceof DomainError && error.code === "FORBIDDEN" ? 403 : 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}

function download(body: BodyInit, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
