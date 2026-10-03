import { db } from "@/lib/db";

/** Empty every application table (keeping seeded reference data). Call in `beforeEach`. */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations', 'structure_templates', 'template_beats')`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  // Built-in templates are reference data seeded by migrations; keep them.
  await db.structureTemplate.deleteMany({ where: { workspaceId: { not: null } } });
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
