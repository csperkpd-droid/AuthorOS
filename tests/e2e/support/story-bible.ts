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

/** The "Characters in this scene" panel of the scene page. */
export const sceneCast = (page: Page) =>
  page.getByRole("region", { name: "Characters in this scene" });

/** One character in the scene panel; its name says their part ("Mara: Present"). */
export const castMember = (page: Page, name: string) =>
  sceneCast(page).getByRole("listitem", { name: new RegExp(`^${name}:`) });

/** Expects a character's part in the scene, e.g. "Point of view, present" or "Mentioned". */
export async function expectPart(page: Page, name: string, part: string) {
  await expect(castMember(page, name)).toHaveAccessibleName(`${name}: ${part}`);
}

/**
 * Adds a character to the current scene with "Add character": an existing
 * one (found by `search`) or a new one (`create`).
 */
export async function addToScene(
  page: Page,
  name: string,
  {
    search,
    create = false,
    presence,
    pov,
  }: { search?: string; create?: boolean; presence?: "Present" | "Mentioned"; pov?: boolean } = {},
) {
  await sceneCast(page).getByRole("button", { name: "Add character" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a character to this scene" });
  await dialog.getByLabel("Character name").fill(search ?? name);
  if (presence) await dialog.getByLabel("In this scene").selectOption(presence.toUpperCase());
  if (pov !== undefined) await dialog.getByLabel("Point of view").setChecked(pov);
  if (create) await dialog.getByRole("button", { name: `Create “${name}”` }).click();
  else
    await dialog
      .getByRole("list", { name: "Characters" })
      .getByRole("button", { name, exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(castMember(page, name)).toBeVisible();
}

/** Opens a character's menu in the scene panel and chooses an item. */
export async function changePart(page: Page, name: string, item: string | RegExp) {
  await sceneCast(page)
    .getByRole("button", { name: `Change ${name}’s part in this scene` })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

export { expectSaved };
