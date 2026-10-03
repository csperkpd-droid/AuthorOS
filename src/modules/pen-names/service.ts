import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";

export async function listPenNames(ctx: AuthorContext) {
  return db.penName.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, bio: true, isDefault: true },
  });
}
