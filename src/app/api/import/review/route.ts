import { reviewImport } from "@/modules/imports";

import { handleImport, importOptionsFrom } from "../handler";

/** Checks an import file and describes what importing it would do. Changes nothing. */
export async function POST(request: Request) {
  return handleImport(request, (ctx, file, params) =>
    reviewImport(ctx, file, importOptionsFrom(params)),
  );
}
