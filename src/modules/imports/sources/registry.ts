import "server-only";

import { RuleError } from "@/lib/errors";

import { parseAuthorOsJson } from "./authoros-json";
import { IMPORT_SOURCES, type ImportSourceId } from "./catalog";
import type { ImportParser } from "./types";

/**
 * Parsers for the available sources. Adding a source = an entry in
 * `catalog.ts` and a parser here that returns a Workspace Bundle.
 */
const PARSERS: Partial<Record<ImportSourceId, ImportParser>> = {
  "authoros-json": parseAuthorOsJson,
};

export function parserFor(sourceId: string): ImportParser {
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId);
  const parser = source?.available ? PARSERS[source.id] : undefined;
  if (!parser) throw new RuleError("That import source isn’t available yet.");
  return parser;
}
