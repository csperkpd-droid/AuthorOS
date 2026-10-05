import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

import type { ImpactGroup } from "./types";

type Client = Prisma.TransactionClient | typeof db;

/**
 * What is attached to story objects that are about to be removed for good:
 * links to other objects (which stay), custom field values and dates (which
 * go). As report groups, so every removal shows them the same way.
 */
export async function attachmentsOf(
  ctx: AuthorContext,
  ids: string[],
  client: Client = db,
): Promise<(Omit<ImpactGroup, "affected"> & { count: number })[]> {
  assertCanView(ctx, "any");
  const ws = ctx.workspaceId;
  const doomed = new Set(ids);
  const [links, values, dates] = await Promise.all([
    client.connection.findMany({
      where: { workspaceId: ws, OR: [{ sourceId: { in: ids } }, { targetId: { in: ids } }] },
      select: { sourceId: true, targetId: true },
    }),
    client.nodeFieldValue.count({ where: { workspaceId: ws, nodeId: { in: ids } } }),
    client.calendarEvent.count({ where: { workspaceId: ws, subjectId: { in: ids } } }),
  ]);
  const others = await resolveNodes(
    ctx,
    links.flatMap((l) => [l.sourceId, l.targetId]).filter((id) => !doomed.has(id)),
  );
  return [
    {
      key: "LINKS",
      label: "Links to other items",
      noun: { one: "link", many: "links" },
      effect: "Link removed; the other items stay",
      items: [...others.values()].map((n) => ({ id: n.id, title: n.title, href: n.href })),
      count: links.length,
    },
    {
      key: "FIELD_VALUES",
      label: "Custom field values",
      noun: { one: "field value", many: "field values" },
      effect: "Deleted",
      items: [],
      count: values,
    },
    {
      key: "DATES",
      label: "Dates on the calendar",
      noun: { one: "date", many: "dates" },
      effect: "Deleted",
      items: [],
      count: dates,
    },
  ];
}
