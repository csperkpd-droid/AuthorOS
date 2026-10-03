import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";

let seedSql: string | null = null;

/**
 * The built-in reference data (structure templates) as one statement, taken
 * from the migrations that seed it.
 */
async function builtInSeed() {
  if (seedSql !== null) return seedSql;
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const inserts: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8").catch(() => "");
    inserts.push(
      ...sql
        .split("\n")
        .filter((l) => /^INSERT INTO "(structure_templates|template_beats)"/.test(l)),
    );
  }
  seedSql = `DO $seed$ BEGIN ${inserts.join("\n")} END $seed$;`;
  return seedSql;
}

/**
 * Empty every application table, then restore the seeded reference data
 * (built-in templates, which cascade with workspaces). Call in `beforeEach`.
 */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  await db.$executeRawUnsafe(await builtInSeed());
}

export async function createUser(
  email = `author-${crypto.randomUUID()}@example.com`,
  name?: string,
) {
  return db.user.create({ data: { email, name } });
}

/** A signed-up author with a workspace, ready to pass to services. */
export async function createAuthor(name = "Test Author") {
  const { ensurePersonalWorkspace } = await import("@/modules/workspaces");
  const user = await createUser(undefined, name);
  const membership = await ensurePersonalWorkspace(user);
  return { userId: user.id, ...membership };
}

/** A pen-name story node, for creating pen names directly in tests. */
export async function penNode(workspaceId: string) {
  return db.storyNode.create({ data: { workspaceId, kind: "PEN_NAME" }, select: { id: true } });
}
