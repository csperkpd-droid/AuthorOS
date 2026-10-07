/**
 * Every import source AuthorOS knows about (client-safe: no parsing code).
 * Only available sources can be chosen; the others are planned and shown so
 * authors know what's coming. Parsers live in `./registry.ts`.
 */
export type ImportSourceInfo = {
  id: string;
  label: string;
  description: string;
  /** File name endings the source reads. */
  extensions: string[];
  available: boolean;
};

export const IMPORT_SOURCES = [
  {
    id: "authoros-json",
    label: "Spellbound Draft backup (.json)",
    description:
      "A Standard backup or Complete archive exported from Spellbound Draft (AuthorOS backups work too): restores everything it contains, with its ids, identities and links.",
    extensions: [".json"],
    available: true,
  },
  {
    id: "scrivener",
    label: "Scrivener project",
    description: "Binder, documents and synopses.",
    extensions: [".scriv", ".zip"],
    available: false,
  },
  {
    id: "plottr",
    label: "Plottr",
    description: "Timelines, plotlines, characters and places.",
    extensions: [".pltr"],
    available: false,
  },
  {
    id: "docx",
    label: "Word document (.docx)",
    description: "A manuscript split into chapters and scenes by its headings.",
    extensions: [".docx"],
    available: false,
  },
  {
    id: "epub",
    label: "EPUB",
    description: "A published book's chapters.",
    extensions: [".epub"],
    available: false,
  },
] as const satisfies readonly ImportSourceInfo[];

export type ImportSourceId = (typeof IMPORT_SOURCES)[number]["id"];
