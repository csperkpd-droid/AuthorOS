import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

test("navigates between sections", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Tasks/ }).click();

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page.getByLabel("New task")).toBeVisible();
});

test("has no horizontal overflow", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
