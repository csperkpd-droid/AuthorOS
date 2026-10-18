import { describe, expect, it } from "vitest";

import { taskTitleFromComment } from "./task-title";

describe("taskTitleFromComment", () => {
  it("puts the comment's words on one line", () => {
    expect(taskTitleFromComment("  Check the\n\nsource   please. ")).toBe(
      "Check the source please.",
    );
  });

  it("shortens long comments to a valid title", () => {
    const title = taskTitleFromComment("word ".repeat(200));
    expect(title.length).toBeLessThanOrEqual(300);
    expect(title.endsWith("…")).toBe(true);
  });
});
