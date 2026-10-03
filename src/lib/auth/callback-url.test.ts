import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, safeCallbackUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeCallbackUrl("/library?tab=books")).toBe("/library?tab=books");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["absolute URL", "https://evil.example/phish"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["sign-in loop", "/sign-in?callbackUrl=/x"],
    ["auth API", "/api/auth/signout"],
    ["non-string", ["/library"]],
  ])("falls back to the dashboard for %s", (_label, value) => {
    expect(safeCallbackUrl(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});
