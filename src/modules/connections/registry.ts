import type { StoryNodeKind } from "@/generated/prisma/enums";

/**
 * The Universal Connection registry. Every link between two story objects
 * has a kind defined here: which node kinds it may join, how it reads in each
 * direction, and an optional single-choice attribute.
 *
 * Adding a connection kind, or letting a new object type take part in an
 * existing one, is a change to this file only: the `connections` table stores
 * the kind as text and validates nothing type-specific.
 */
export type ConnectionAttribute = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue: string;
};

export type ConnectionKindDef = {
  /** Read from the source: "Mara — Appears in — Scene 3". */
  label: string;
  /** Read from the target: "Scene 3 — Characters — Mara". */
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

export const SCENE_ROLES = [
  { value: "POV", label: "Point of view" },
  { value: "PRESENT", label: "Present" },
  { value: "MENTIONED", label: "Mentioned" },
];

export const CONNECTION_KINDS = {
  appears_in: {
    label: "Appears in",
    inverseLabel: "Characters",
    directed: true,
    from: ["CHARACTER"],
    to: ["SCENE"],
    attribute: { key: "role", label: "Role", options: SCENE_ROLES, defaultValue: "PRESENT" },
    hint: "A character is in a scene: as the point of view, present, or mentioned.",
  },
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

const allows = (set: StoryNodeKind[] | "*", kind: StoryNodeKind) =>
  set === "*" || set.includes(kind);

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
