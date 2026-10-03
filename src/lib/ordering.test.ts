import { describe, expect, it } from "vitest";

import { planInsertAfter, positionAtEnd, sortByPosition, type Positioned } from "./ordering";

function apply(siblings: Positioned[], id: string, afterId: string | null) {
  const plan = planInsertAfter(siblings, afterId);
  const rekeyed = new Map(plan.rebalanced.map((r) => [r.id, r.position]));
  const next = siblings.map((s) => ({ ...s, position: rekeyed.get(s.id) ?? s.position }));
  return sortByPosition([...next, { id, position: plan.position }]).map((s) => s.id);
}

describe("ordering", () => {
  const abc: Positioned[] = [
    { id: "a", position: "a0" },
    { id: "b", position: "a1" },
    { id: "c", position: "a2" },
  ];

  it("inserts first, between, and last", () => {
    expect(apply(abc, "x", null)).toEqual(["x", "a", "b", "c"]);
    expect(apply(abc, "x", "a")).toEqual(["a", "x", "b", "c"]);
    expect(apply(abc, "x", "c")).toEqual(["a", "b", "c", "x"]);
  });

  it("starts an empty list", () => {
    expect(planInsertAfter([], null).position).toBeTypeOf("string");
    expect(positionAtEnd([])).toBeTypeOf("string");
  });

  it("appends after the last item regardless of input order", () => {
    const end = positionAtEnd([abc[2], abc[0], abc[1]]);
    expect(end > "a2").toBe(true);
  });

  it("rebalances when neighbouring keys collide", () => {
    const collided: Positioned[] = [
      { id: "a", position: "a0" },
      { id: "b", position: "a1" },
      { id: "c", position: "a1" },
    ];
    const plan = planInsertAfter(collided, "b");
    expect(plan.rebalanced).toHaveLength(3);
    expect(apply(collided, "x", "b")).toEqual(["a", "b", "x", "c"]);
  });

  it("supports many repeated inserts at the same spot", () => {
    let list: Positioned[] = [{ id: "first", position: positionAtEnd([]) }];
    for (let i = 0; i < 50; i++) {
      const plan = planInsertAfter(list, "first");
      list = [...list, { id: `n${i}`, position: plan.position }];
    }
    const order = sortByPosition(list).map((s) => s.id);
    expect(order[0]).toBe("first");
    expect(order[1]).toBe("n49");
    expect(order.at(-1)).toBe("n0");
  });

  it("rejects an unknown sibling", () => {
    expect(() => planInsertAfter(abc, "missing")).toThrow();
  });
});
