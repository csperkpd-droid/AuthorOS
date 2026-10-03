import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

test("navigates to a planned section", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Ideas/ }).click();

  await expect(page).toHaveURL(/\/ideas$/);
  await expect(page.getByRole("heading", { name: "Ideas" })).toBeVisible();
  await expect(page.getByText("Coming in Milestone 2")).toBeVisible();
});

test("has no horizontal overflow", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
