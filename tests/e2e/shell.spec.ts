import { expect, test } from "@playwright/test";

import { uniqueEmail, waitForMagicLink } from "./support/outbox";

test.beforeEach(async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.goto(await waitForMagicLink(email));
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("navigates to a planned section", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Library/ })
    .click();

  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Coming in Milestone 1")).toBeVisible();
});

test("has no horizontal overflow", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
