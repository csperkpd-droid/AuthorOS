import { runImport } from "@/modules/imports";

import { handleImport, importOptionsFrom } from "../handler";

export const maxDuration = 600;

/** Imports a reviewed file (`token` from the review): everything, or nothing. */
export async function POST(request: Request) {
  return handleImport(request, (ctx, file, params) =>
    runImport(ctx, file, { ...importOptionsFrom(params), token: params.get("token") ?? "" }),
  );
}
