import { runImport } from "@/modules/imports";

import { handleImport, importOptionsFrom } from "../handler";

// Vercel Hobby allows at most 300 s per request (Pro allows more); large
// imports move to a background job when one is needed (docs/ARCHITECTURE.md).
export const maxDuration = 300;

/** Imports a reviewed file (`token` from the review): everything, or nothing. */
export async function POST(request: Request) {
  return handleImport(request, (ctx, file, params) =>
    runImport(ctx, file, { ...importOptionsFrom(params), token: params.get("token") ?? "" }),
  );
}
