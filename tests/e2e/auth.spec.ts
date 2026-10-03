import { expect, test, type Page } from "@playwright/test";

import { uniqueEmail, waitForMagicLink } from "./support/outbox";

async function signInWithMagicLink(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page).toHaveURL(/\/sign-in\/check-email$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await waitForMagicLink(email));
}

test("protected pages redirect to sign-in and return afterwards", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fsettings/);

  await signInWithMagicLink(page, uniqueEmail());

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("first sign-in creates a workspace with a default pen name", async ({ page }) => {
  const email = uniqueEmail();
  const handle = email.split("@")[0];

  await page.goto("/sign-in");
  await signInWithMagicLink(page, email);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(`${handle}'s workspace`)).toBeVisible();

  await page.goto("/settings");
  const penNames = page.getByRole("listitem").filter({ hasText: "Default" });
  await expect(penNames).toHaveText(new RegExp(handle));
});

test("rejects an invalid email without sending a link", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a valid email address." }),
  ).toBeVisible();
});

test("a used sign-in link cannot be reused", async ({ page, browser }) => {
  const email = uniqueEmail();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const link = await waitForMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard$/);

  const other = await browser.newPage();
  await other.goto(link);
  await expect(
    other.getByRole("alert").filter({ hasText: "expired or was already used" }),
  ).toBeVisible();
  await other.close();
});

test("signing out ends the session", async ({ page, isMobile }) => {
  await page.goto("/sign-in");
  await signInWithMagicLink(page, uniqueEmail());
  await expect(page).toHaveURL(/\/dashboard$/);

  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
