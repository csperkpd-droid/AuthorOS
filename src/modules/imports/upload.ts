import "server-only";

import { gunzipSync } from "node:zlib";

import { ImportFileError } from "./errors";
import { MAX_IMPORT_BYTES } from "./schemas";

/** Largest upload accepted (the browser gzips the file first). */
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/**
 * Reads an uploaded import file from a request body: gzip-compressed
 * (`Content-Type: application/gzip`, what the import page sends) or as is.
 * Decompression is capped, so a small upload can't expand without limit.
 */
export async function readUpload(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES)
    throw new ImportFileError(["The file is too large to import (200 MB at most)."]);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_UPLOAD_BYTES)
    throw new ImportFileError(["The file is too large to import (200 MB at most)."]);
  if (request.headers.get("content-type")?.startsWith("application/gzip")) {
    try {
      return new Uint8Array(gunzipSync(body, { maxOutputLength: MAX_IMPORT_BYTES }));
    } catch (error) {
      if (error instanceof RangeError)
        throw new ImportFileError(["The file is too large to import (200 MB at most)."]);
      throw new ImportFileError(["The upload was damaged. Try again."]);
    }
  }
  return body;
}

/**
 * Route handlers don't get Server Actions' built-in origin check: refuse
 * cross-site posts so another site can't import into an author's workspace.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
