import { describe, expect, it } from "vitest";

import { NODE_KINDS } from "@/modules/story-graph/ui";

import { canConnect, connectionOptionsFor, isConnectionKind, labelFrom } from "./registry";

describe("connection registry", () => {
  it("allows typed kinds only between their node kinds, in their direction", () => {
    expect(canConnect("develops_in", "RELATIONSHIP", "SCENE")).toBe(true);
    // Either order is accepted (the service stores it source → target)…
    expect(canConnect("develops_in", "SCENE", "RELATIONSHIP")).toBe(true);
    // …unless the exact direction is asked for.
    expect(canConnect("develops_in", "SCENE", "RELATIONSHIP", { directedOnly: true })).toBe(false);
    expect(canConnect("develops_in", "NOTE", "SCENE")).toBe(false);
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
      expect.arrayContaining(["develops_in:in", "about:in", "inspired:in", "related:out"]),
    );
    expect(scene).not.toContain("develops_in:out");

    const relationship = connectionOptionsFor("RELATIONSHIP", NODE_KINDS);
    expect(relationship.find((o) => o.kind === "develops_in")).toMatchObject({
      asSource: true,
      otherKinds: ["SCENE"],
    });
  });

  it("reads each way", () => {
    expect(labelFrom("develops_in", true)).toBe("Develops in");
    expect(labelFrom("develops_in", false)).toBe("Relationship moments");
    expect(labelFrom("related", false)).toBe("Related to");
  });

  it("has no scene-appearance kind: that is Scene Participation (decision 106)", () => {
    expect(isConnectionKind("appears_in")).toBe(false);
  });

  it("covers every node kind with at least one connection option", () => {
    for (const kind of NODE_KINDS)
      expect(connectionOptionsFor(kind, NODE_KINDS).length).toBeGreaterThan(0);
  });
});
