import { expect, type Page } from "@playwright/test";

import { createBook, expectSaved } from "./manuscript";

const post = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");

export async function createCharacter(
  page: Page,
  name: string,
  role?: string,
  { series }: { series?: string } = {},
) {
  await page.goto("/characters");
  await page.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  if (role) await dialog.getByLabel("Role").selectOption({ label: role });
  if (series) await dialog.getByLabel("Series").selectOption({ label: series });
  await dialog.getByRole("button", { name: "Create character" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

/** A book with one chapter and one scene; returns the scene URL (editor open). */
export async function createBookWithScene(page: Page, title: string) {
  await createBook(page, title);
  let saved = post(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await saved;
  saved = post(page);
  await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
  await saved;
  await page.getByRole("link", { name: "Scene 1" }).click();
  await expect(page).toHaveURL(/\/scenes\//);
  return page.url();
}

/** Uses the generic "Connect" dialog on the current page. */
export async function connectTo(
  page: Page,
  { kind, search, pick }: { kind?: string; search: string; pick: string | RegExp },
) {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add connection" });
  if (kind) await dialog.getByLabel("Connection").selectOption({ label: kind });
  await dialog.getByLabel(/^Find/).fill(search);
  await dialog
    .getByRole("list", { name: "Search results" })
    .getByRole("button", { name: pick })
    .click();
  const saved = post(page);
  await dialog.getByRole("button", { name: /^Connect “/ }).click();
  await saved;
  await expect(dialog).toBeHidden();
}

export { expectSaved };
