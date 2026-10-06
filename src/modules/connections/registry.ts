import type { StoryNodeKind } from "@/generated/prisma/enums";
import { STORY_OBJECT_TYPES } from "@/modules/story-graph/ui";

/**
 * The Universal Connection registry.
 *
 * Rules every kind inherits (enforced by the service): both ends visible and
 * in the same workspace, and never across author identities (an object of
 * one pen name can't link to an object of another; shared objects such as
 * notes and ideas link to any). Every link between two story objects
 * has a kind defined here: which node kinds it may join, how it reads in each
 * direction, and an optional single-choice attribute.
 *
 * Adding a connection kind, or letting a new object type take part in an
 * existing one, is a change to this file only: the `connections` table stores
 * the kind as text and validates nothing type-specific.
 *
 * Relationships the product relies on are not connection kinds: a
 * character in a scene is Scene Participation (`participation` module,
 * decision 106), which replaced the former `appears_in` kind.
 */
export type ConnectionAttribute = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue: string;
};

export type ConnectionKindDef = {
  /** Read from the source: "Note — About — Scene 3". */
  label: string;
  /** Read from the target: "Scene 3 — Notes — Note". */
  inverseLabel: string;
  /** Undirected kinds read the same both ways and are stored once per pair. */
  directed: boolean;
  /** Allowed source and target kinds ("*" = any kind). */
  from: StoryNodeKind[] | "*";
  to: StoryNodeKind[] | "*";
  attribute?: ConnectionAttribute;
  /** One-line explanation shown when choosing a kind. */
  hint: string;
};

export const CONNECTION_KINDS = {
  develops_in: {
    label: "Develops in",
    inverseLabel: "Relationship moments",
    directed: true,
    from: ["RELATIONSHIP"],
    to: ["SCENE"],
    hint: "A scene where this relationship changes.",
  },
  about: {
    label: "About",
    inverseLabel: "Notes",
    directed: true,
    from: ["NOTE"],
    to: "*",
    hint: "What a note is about.",
  },
  inspired: {
    label: "Inspired",
    inverseLabel: "Inspired by",
    directed: true,
    from: ["IDEA"],
    to: "*",
    hint: "Something this idea led to.",
  },
  concerns: {
    label: "Concerns",
    inverseLabel: "Tasks & dates",
    directed: true,
    from: ["TASK", "EVENT"],
    to: "*",
    hint: "What a task or calendar event is for.",
  },
  related: {
    label: "Related to",
    inverseLabel: "Related to",
    directed: false,
    from: "*",
    to: "*",
    hint: "Any other link you want to remember.",
  },
} satisfies Record<string, ConnectionKindDef>;

export type ConnectionKind = keyof typeof CONNECTION_KINDS;

export const CONNECTION_KIND_KEYS = Object.keys(CONNECTION_KINDS) as ConnectionKind[];

export function isConnectionKind(value: string): value is ConnectionKind {
  return Object.hasOwn(CONNECTION_KINDS, value);
}

export function getKind(kind: ConnectionKind): ConnectionKindDef {
  return CONNECTION_KINDS[kind];
}

/** "*" = every kind the Story Object Registry marks connectable. */
const allows = (set: StoryNodeKind[] | "*", kind: StoryNodeKind) =>
  STORY_OBJECT_TYPES[kind].connectable && (set === "*" || set.includes(kind));

/**
 * Whether `kind` may join these two node kinds. Undirected kinds accept either
 * order; directed kinds too, unless `directedOnly` (exactly source → target).
 */
export function canConnect(
  kind: ConnectionKind,
  source: StoryNodeKind,
  target: StoryNodeKind,
  { directedOnly = false }: { directedOnly?: boolean } = {},
): boolean {
  const def = getKind(kind);
  if (allows(def.from, source) && allows(def.to, target)) return true;
  if (directedOnly) return false;
  return allows(def.from, target) && allows(def.to, source);
}

/**
 * The ways a node of `kind` can be connected: each option says whether the
 * node is the source or the target, and which kinds can be on the other end.
 */
export function connectionOptionsFor(kind: StoryNodeKind, allKinds: StoryNodeKind[]) {
  const options: {
    kind: ConnectionKind;
    asSource: boolean;
    label: string;
    otherKinds: StoryNodeKind[];
  }[] = [];
  for (const key of CONNECTION_KIND_KEYS) {
    const def = getKind(key);
    if (allows(def.from, kind)) {
      const others = allKinds.filter((k) => allows(def.to, k));
      if (others.length)
        options.push({ kind: key, asSource: true, label: def.label, otherKinds: others });
    }
    if (def.directed && allows(def.to, kind)) {
      const others = allKinds.filter((k) => allows(def.from, k));
      if (others.length)
        options.push({ kind: key, asSource: false, label: def.inverseLabel, otherKinds: others });
    }
  }
  return options;
}

/** How a connection reads from one of its ends. */
export function labelFrom(kind: ConnectionKind, isSource: boolean): string {
  const def = getKind(kind);
  return isSource || !def.directed ? def.label : def.inverseLabel;
}
