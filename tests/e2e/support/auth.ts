import { expect, type Page } from "@playwright/test";

import { uniqueEmail, waitForMagicLink } from "./outbox";

/** Signs up a fresh author through the real magic-link flow. */
export async function signUp(page: Page, email = uniqueEmail()) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page).toHaveURL(/\/sign-in\/check-email$/);
  await page.goto(await waitForMagicLink(email));
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}
