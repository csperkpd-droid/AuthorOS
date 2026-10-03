import { describe, expect, it } from "vitest";

import { NODE_KINDS } from "@/modules/story-graph/ui";

import { canConnect, connectionOptionsFor, labelFrom } from "./registry";

describe("connection registry", () => {
  it("allows typed kinds only between their node kinds, in their direction", () => {
    expect(canConnect("appears_in", "CHARACTER", "SCENE")).toBe(true);
    // Either order is accepted (the service stores it source → target)…
    expect(canConnect("appears_in", "SCENE", "CHARACTER")).toBe(true);
    // …unless the exact direction is asked for.
    expect(canConnect("appears_in", "SCENE", "CHARACTER", { directedOnly: true })).toBe(false);
    expect(canConnect("appears_in", "NOTE", "SCENE")).toBe(false);
    expect(canConnect("about", "NOTE", "BOOK")).toBe(true);
    expect(canConnect("about", "BOOK", "NOTE", { directedOnly: true })).toBe(false);
    expect(canConnect("about", "BOOK", "IDEA")).toBe(false);
  });

  it("lets undirected kinds join any pair, in either order", () => {
    expect(canConnect("related", "CHARACTER", "CHARACTER")).toBe(true);
    expect(canConnect("related", "SCENE", "IDEA")).toBe(true);
  });

  it("lists the options for a node from both ends", () => {
    const scene = connectionOptionsFor("SCENE", NODE_KINDS).map(
      (o) => `${o.kind}:${o.asSource ? "out" : "in"}`,
    );
    expect(scene).toEqual(
      expect.arrayContaining([
        "appears_in:in",
        "develops_in:in",
        "about:in",
        "inspired:in",
        "related:out",
      ]),
    );
    expect(scene).not.toContain("appears_in:out");

    const character = connectionOptionsFor("CHARACTER", NODE_KINDS);
    expect(character.find((o) => o.kind === "appears_in")).toMatchObject({
      asSource: true,
      otherKinds: ["SCENE"],
    });
  });

  it("reads each way", () => {
    expect(labelFrom("appears_in", true)).toBe("Appears in");
    expect(labelFrom("appears_in", false)).toBe("Characters");
    expect(labelFrom("related", false)).toBe("Related to");
  });

  it("covers every node kind with at least one connection option", () => {
    for (const kind of NODE_KINDS)
      expect(connectionOptionsFor(kind, NODE_KINDS).length).toBeGreaterThan(0);
  });
});
