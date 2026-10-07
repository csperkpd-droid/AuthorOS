"use client";

import { Link2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import type { StoryNodeKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { disconnectAction, updateConnectionAction } from "../actions";
import { CONNECTION_KIND_KEYS, getKind, type ConnectionKind } from "../registry";
import type { ConnectionView } from "../service";
import { AddConnectionDialog } from "./add-connection-dialog";
import { NodeLink } from "./node-link";

/**
 * Every connection of one story object, grouped by how they read from it
 * ("Appears in", "Notes", "Related to"…). Works for any node kind.
 */
export function ConnectionsPanel({
  nodeId,
  nodeKind,
  connections,
  heading = "Connections",
  hideKinds = [],
  actions,
  emptyText = "Nothing connected yet.",
}: {
  nodeId: string;
  nodeKind: StoryNodeKind;
  connections: ConnectionView[];
  heading?: string;
  /** Kinds shown elsewhere on the page (e.g. a scene's cast). */
  hideKinds?: ConnectionKind[];
  /** Extra header buttons, e.g. "New note". */
  actions?: ReactNode;
  emptyText?: string;
}) {
  const visible = connections.filter((c) => !hideKinds.includes(c.kind));
  const groups = new Map<string, ConnectionView[]>();
  const order = (c: ConnectionView) =>
    CONNECTION_KIND_KEYS.indexOf(c.kind) * 2 + (c.isSource ? 0 : 1);
  for (const c of [...visible].sort((a, b) => order(a) - order(b))) {
    groups.set(c.heading, [...(groups.get(c.heading) ?? []), c]);
  }
  const allowedKinds = CONNECTION_KIND_KEYS.filter((k) => !hideKinds.includes(k));

  return (
    <section aria-label={heading} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <div className="flex flex-wrap gap-2">
          {actions}
          <AddConnectionDialog
            nodeId={nodeId}
            nodeKind={nodeKind}
            onlyKinds={allowedKinds}
            trigger={
              <Button variant="outline" size="sm">
                <Link2 />
                Connect
              </Button>
            }
          />
        </div>
      </div>
      {groups.size === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-4">
          {[...groups].map(([groupHeading, items]) => (
            <div key={groupHeading}>
              {/* A lone group named like the panel needs no second heading. */}
              {!(groups.size === 1 && groupHeading === heading) && (
                <h3 className="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  {groupHeading}
                </h3>
              )}
              <ul
                aria-label={groupHeading}
                className="divide-y divide-border rounded-lg border border-border bg-surface"
              >
                {items.map((c) => (
                  <ConnectionRow key={c.id} connection={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectionRow({ connection: c }: { connection: ConnectionView }) {
  const remove = useAction(disconnectAction);
  const update = useAction(updateConnectionAction);
  const attribute = getKind(c.kind).attribute;

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <NodeLink node={c.other} />
        {(c.label || c.note) && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[c.label, c.note].filter(Boolean).join(" — ")}
          </p>
        )}
      </div>
      {attribute && (
        <select
          aria-label={`${attribute.label} of ${c.other.title}`}
          value={c.attribute ?? attribute.defaultValue}
          disabled={update.pending}
          onChange={(e) => update.run(c.id, { attribute: e.target.value })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        >
          {attribute.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="size-8 p-0"
        aria-label={`Remove connection to ${c.other.title}`}
        disabled={remove.pending}
        onClick={() => remove.run(c.id)}
      >
        <X />
      </Button>
      <FormError message={remove.error ?? update.error} />
    </li>
  );
}
