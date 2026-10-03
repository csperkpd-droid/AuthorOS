import { db } from "@/lib/db";

/** Empty every application table. Call in `beforeEach` of integration tests. */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export async function createUser(
  email = `author-${crypto.randomUUID()}@example.com`,
  name?: string,
) {
  return db.user.create({ data: { email, name } });
}
