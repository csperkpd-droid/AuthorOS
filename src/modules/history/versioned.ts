import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { countWords } from "@/lib/text";

/**
 * Story objects whose rich text is versioned. Each kind says how to lock,
 * read and write its content; everything else (conflict checks, checkpoints,
 * named versions, restore) is shared. Add a kind here to give it history.
 */
export const VERSIONED_KINDS = ["SCENE", "NOTE"] as const;
export type VersionedKind = (typeof VERSIONED_KINDS)[number];

export type Content = { content: Prisma.JsonValue | null; text: string; wordCount: number };
type Written = { version: number; savedAt: Date };
type Tx = Prisma.TransactionClient;

const json = (value: Prisma.JsonValue | null) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

export const versioned: Record<
  VersionedKind,
  {
    /** What authors call it, for messages. */
    noun: string;
    /** Row-locks the object and returns its current version (null if missing). */
    lock: (tx: Tx, id: string) => Promise<number | null>;
    read: (tx: Tx, id: string) => Promise<Content>;
    write: (tx: Tx, id: string, content: Content) => Promise<Written>;
  }
> = {
  SCENE: {
    noun: "scene",
    lock: async (tx, id) =>
      (
        await tx.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "scenes" WHERE "id" = ${id}::uuid FOR UPDATE`
      )[0]?.version ?? null,
    read: async (tx, id) => {
      const s = await tx.scene.findUniqueOrThrow({
        where: { id },
        select: { content: true, contentText: true, wordCount: true },
      });
      return { content: s.content, text: s.contentText, wordCount: s.wordCount };
    },
    write: async (tx, id, c) => {
      const s = await tx.scene.update({
        where: { id },
        data: {
          content: json(c.content),
          contentText: c.text,
          wordCount: c.wordCount,
          version: { increment: 1 },
        },
        select: { version: true, updatedAt: true },
      });
      return { version: s.version, savedAt: s.updatedAt };
    },
  },
  NOTE: {
    noun: "note",
    lock: async (tx, id) =>
      (
        await tx.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "notes" WHERE "id" = ${id}::uuid FOR UPDATE`
      )[0]?.version ?? null,
    read: async (tx, id) => {
      const n = await tx.note.findUniqueOrThrow({
        where: { id },
        select: { body: true, bodyText: true },
      });
      // Notes don't store a word count; revisions compute one for display.
      return { content: n.body, text: n.bodyText, wordCount: countWords(n.bodyText) };
    },
    write: async (tx, id, c) => {
      const n = await tx.note.update({
        where: { id },
        data: { body: json(c.content), bodyText: c.text, version: { increment: 1 } },
        select: { version: true, updatedAt: true },
      });
      return { version: n.version, savedAt: n.updatedAt };
    },
  },
};

export function isVersionedKind(kind: string): kind is VersionedKind {
  return (VERSIONED_KINDS as readonly string[]).includes(kind);
}
