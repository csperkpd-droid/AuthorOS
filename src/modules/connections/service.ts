import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import {
  nodeKind,
  resolveNode,
  resolveNodes,
  sameIdentity,
  type NodeSummary,
} from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { canConnect, getKind, isConnectionKind, labelFrom, type ConnectionKind } from "./registry";
import {
  connectionDetails,
  newConnectionInput,
  type ConnectionDetails,
  type NewConnectionInput,
} from "./schemas";

export type ConnectionView = {
  id: string;
  kind: ConnectionKind;
  /** True when the node being viewed is the source of this connection. */
  isSource: boolean;
  /** How the connection reads from the viewed node ("Appears in", "Notes"…). */
  heading: string;
  other: NodeSummary;
  label: string | null;
  note: string | null;
  /** The value of the kind's attribute, if it has one (e.g. "POV"). */
  attribute: string | null;
};

function attributesFor(
  kind: ConnectionKind,
  value: string | null | undefined,
): Prisma.InputJsonObject {
  const def = getKind(kind);
  if (!def.attribute) {
    if (value) throw new RuleError("This kind of connection has no options.");
    return {};
  }
  const chosen = value ?? def.attribute.defaultValue;
  if (!def.attribute.options.some((o) => o.value === chosen)) {
    throw new RuleError(`“${chosen}” is not a valid ${def.attribute.label.toLowerCase()}.`);
  }
  return { [def.attribute.key]: chosen };
}

export type ConnectionPlan = {
  kind: ConnectionKind;
  sourceId: string;
  targetId: string;
  label: string | null;
  note: string | null;
  attributes: Prisma.InputJsonObject;
};

/**
 * Validates a connection without writing it. Both ends must exist in this
 * workspace and be visible, unless an end is `pending` (a node being created
 * in the same transaction, whose kind the caller supplies). The kind must
 * allow the pair; directed kinds offered from the target's side are flipped,
 * and undirected kinds are stored once per pair, in id order.
 */
export async function planConnection(
  ctx: AuthorContext,
  input: NewConnectionInput,
  pending?: { id: string; kind: NodeSummary["kind"] },
): Promise<ConnectionPlan> {
  assertCanView(ctx, "any");
  const data = newConnectionInput.parse(input);
  if (!isConnectionKind(data.kind)) throw new RuleError("Unknown kind of connection.");
  const kind = data.kind;
  if (data.sourceId === data.targetId)
    throw new RuleError("Something can’t be connected to itself.");

  // A pending node (created in the caller's transaction) is a shared object
  // with no identity or series yet.
  const summaryOf = async (id: string) =>
    pending?.id === id
      ? { kind: pending.kind, penNameId: null, seriesId: null }
      : await resolveNode(ctx, id);
  const [sourceNode, targetNode] = await Promise.all([
    summaryOf(data.sourceId),
    summaryOf(data.targetId),
  ]);
  if (!sourceNode || !targetNode) throw new NotFoundError("Story item");
  if (!sameIdentity(sourceNode, targetNode)) {
    throw new RuleError("These belong to different pen names, so they can’t be connected.");
  }
  const sourceKind = sourceNode.kind;
  const targetKind = targetNode.kind;
  if (!canConnect(kind, sourceKind, targetKind)) {
    throw new RuleError(
      `A ${sourceKind.toLowerCase()} can’t be connected to a ${targetKind.toLowerCase()} that way.`,
    );
  }

  let [sourceId, targetId] = [data.sourceId, data.targetId];
  let [from, to] = [sourceNode, targetNode];
  const def = getKind(kind);
  if (def.directed && !canConnect(kind, sourceKind, targetKind, { directedOnly: true })) {
    [sourceId, targetId] = [targetId, sourceId];
    [from, to] = [to, from];
  }
  if (!def.directed && targetId < sourceId) [sourceId, targetId] = [targetId, sourceId];

  return {
    kind,
    sourceId,
    targetId,
    label: data.label ?? null,
    note: data.note ?? null,
    attributes: attributesFor(kind, data.attribute),
  };
}

/** Writes a planned connection inside the caller's transaction. */
export async function createPlannedConnection(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  plan: ConnectionPlan,
) {
  try {
    return await tx.connection.create({
      data: { workspaceId: ctx.workspaceId, ...plan, createdById: ctx.userId },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("These are already connected that way.");
    }
    throw error;
  }
}

/** Connects two story objects (see planConnection for the rules). */
export async function connect(ctx: AuthorContext, input: NewConnectionInput) {
  assertCan(ctx, "edit", "storyBible");
  const plan = await planConnection(ctx, input);
  return db.$transaction((tx) => createPlannedConnection(tx, ctx, plan));
}

async function requireConnection(ctx: AuthorContext, id: string) {
  const connection = await db.connection.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, kind: true, sourceId: true, targetId: true },
  });
  if (!connection || !isConnectionKind(connection.kind)) throw new NotFoundError("Connection");
  return { ...connection, kind: connection.kind as ConnectionKind };
}

/** Changes a connection's label, note or attribute (e.g. a character's role in a scene). */
export async function updateConnection(ctx: AuthorContext, id: string, input: ConnectionDetails) {
  assertCan(ctx, "edit", "storyBible");
  const data = connectionDetails.parse(input);
  const connection = await requireConnection(ctx, id);
  const attributes =
    data.attribute !== undefined ? attributesFor(connection.kind, data.attribute) : undefined;

  await db.$transaction(async (tx) => {
    await tx.connection.update({
      where: { id },
      data: {
        ...(data.label !== undefined && { label: data.label }),
        ...(data.note !== undefined && { note: data.note }),
        ...(attributes && { attributes }),
      },
    });
  });
}

/** Removes a link. The connected objects are untouched. */
export async function disconnect(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await requireConnection(ctx, id);
  await db.connection.delete({ where: { id } });
}

/**
 * Every visible connection of a node, from that node's point of view.
 * Connections whose other end is in the Trash are hidden (and return when it
 * is restored).
 */
export async function listConnections(
  ctx: AuthorContext,
  nodeId: string,
  { kinds }: { kinds?: ConnectionKind[] } = {},
): Promise<ConnectionView[]> {
  assertCanView(ctx, "any", { kind: "NODE", id: nodeId });
  if (!(await nodeKind(ctx, nodeId))) throw new NotFoundError("Story item");
  const rows = await db.connection.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ sourceId: nodeId }, { targetId: nodeId }],
      ...(kinds ? { kind: { in: kinds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      sourceId: true,
      targetId: true,
      label: true,
      note: true,
      attributes: true,
    },
  });
  const known = rows.filter((r) => isConnectionKind(r.kind));
  const others = await resolveNodes(
    ctx,
    known.map((r) => (r.sourceId === nodeId ? r.targetId : r.sourceId)),
  );

  return known.flatMap((r) => {
    const kind = r.kind as ConnectionKind;
    const isSource = r.sourceId === nodeId;
    const other = others.get(isSource ? r.targetId : r.sourceId);
    if (!other) return [];
    const attrKey = getKind(kind).attribute?.key;
    const attrs = r.attributes as Record<string, unknown>;
    return [
      {
        id: r.id,
        kind,
        isSource,
        heading: labelFrom(kind, isSource),
        other,
        label: r.label,
        note: r.note,
        attribute:
          attrKey && typeof attrs[attrKey] === "string" ? (attrs[attrKey] as string) : null,
      },
    ];
  });
}
