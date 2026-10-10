import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { connectTo, createBookWithScene } from "./support/story-bible";

/**
 * Milestone 15: World objects. Places and world entries are story objects;
 * a scene's setting is the author's statement, kept in its history.
 */

const post = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");
const setting = (page: Page) => page.getByRole("region", { name: "Setting" });
const settingPlaces = (page: Page) =>
  page.getByRole("list", { name: "Where this scene is set" }).getByRole("listitem");

/** A book with two scenes; returns their URLs. */
async function bookWithTwoScenes(page: Page) {
  const first = await createBookWithScene(page, "Harbour Lights");
  const bookUrl = first.split("/scenes/")[0];
  await page.goto(bookUrl);
  const saved = post(page);
  await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
  await saved;
  await page.getByRole("link", { name: "Scene 2" }).click();
  await expect(page).toHaveURL(/\/scenes\//);
  return { bookUrl, first, second: page.url() };
}

/** Sets the open scene in a place: an existing one (found by `search`) or a new one. */
async function setIn(page: Page, name: string, { search }: { search?: string } = {}) {
  await setting(page).getByRole("button", { name: "Set in a place" }).click();
  const dialog = page.getByRole("dialog", { name: "Where is this scene set?" });
  await dialog.getByLabel("Place name").fill(search ?? name);
  const saved = post(page);
  await dialog
    .getByRole("list", { name: "Places" })
    .getByRole("button", { name: search ? name : `Create “${name}”` })
    .click();
  await saved;
  await expect(dialog).toBeHidden();
  await expect(settingPlaces(page).filter({ hasText: name })).toBeVisible();
}

async function restoreFromTrash(page: Page, title: string) {
  await page.goto("/trash");
  await page
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.getByText("The Trash is empty")).toBeVisible();
}

test.describe("Milestone 15: world objects (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone flow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(150_000);
    await signUp(page);
  });

  test("a place lists the scenes set in it, through the Trash and back", async ({ page }) => {
    const { bookUrl, first, second } = await bookWithTwoScenes(page);
    await page.goto(first);
    await setIn(page, "Saltmarsh");
    await page.goto(second);
    await setIn(page, "Saltmarsh", { search: "Salt" });

    // Every change is kept in the scene's history.
    await setting(page).getByRole("button", { name: "Setting changes" }).click();
    const history = page.getByRole("dialog", { name: "Where this scene was set" });
    await expect(history).toContainText("Saltmarsh · Set here");
    await history.getByRole("button", { name: "Close" }).click();

    // The place lists both scenes.
    await settingPlaces(page).getByRole("link", { name: "Saltmarsh" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Saltmarsh" })).toBeVisible();
    const placeUrl = page.url();
    const scenes = page.getByRole("list", { name: "Scenes set in Saltmarsh" });
    await expect(scenes.getByRole("link")).toHaveText(["Scene 1", "Scene 2"]);

    // A scene in the Trash leaves the list, and comes back when restored.
    await page.goto(second);
    await page.getByRole("button", { name: "Move scene to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(new RegExp(`${bookUrl}$`));
    await page.goto(placeUrl);
    await expect(scenes.getByRole("link")).toHaveText(["Scene 1"]);
    await restoreFromTrash(page, "Scene 2");
    await page.goto(placeUrl);
    await expect(scenes.getByRole("link")).toHaveText(["Scene 1", "Scene 2"]);

    // The place in the Trash: scenes keep their text, the setting comes back.
    await page.getByRole("button", { name: "Move place to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/places$/);
    await page.goto(first);
    await expect(setting(page)).toContainText("No place yet");
    await restoreFromTrash(page, "Saltmarsh");
    await page.goto(first);
    await expect(settingPlaces(page).filter({ hasText: "Saltmarsh" })).toBeVisible();
  });

  test("a world entry is created, found by search and linked to a place", async ({ page }) => {
    await page.goto("/places");
    await page.getByRole("button", { name: "New place" }).click();
    const newPlace = page.getByRole("dialog", { name: "New place" });
    await newPlace.getByLabel("Name", { exact: true }).fill("Saltmarsh");
    await newPlace.getByRole("button", { name: "Create place" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Saltmarsh" })).toBeVisible();

    await page.goto("/world-entries");
    await page.getByRole("button", { name: "New world entry" }).click();
    const dialog = page.getByRole("dialog", { name: "New world entry" });
    await dialog.getByLabel("Name", { exact: true }).fill("Lanternwrights");
    await dialog.getByLabel("Type").fill("Organization");
    await dialog.getByLabel("Summary").fill("Keepers of the harbour lamps.");
    await dialog.getByRole("button", { name: "Create entry" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lanternwrights" })).toBeVisible();
    await expect(page.getByText("Keepers of the harbour lamps.")).toBeVisible();

    await connectTo(page, { kind: "Related to", search: "Salt", pick: /Saltmarsh/ });
    await expect(page.getByRole("link", { name: "Saltmarsh" })).toBeVisible();

    await page.goto("/search?q=Lanternwrights");
    await page
      .getByRole("list", { name: "Results" })
      .getByRole("link", { name: /Lanternwrights/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Lanternwrights" })).toBeVisible();
  });
});

test("Milestone 15: world objects on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(150_000);
  await signUp(page);
  const first = await createBookWithScene(page, "Harbour Lights");
  await setIn(page, "Saltmarsh");
  await settingPlaces(page).getByRole("link", { name: "Saltmarsh" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Saltmarsh" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Scenes set in Saltmarsh" }).getByRole("link"),
  ).toHaveText(["Scene 1"]);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow(), "horizontal overflow on the place").toBeLessThanOrEqual(0);

  await page.goto(first);
  expect(await overflow(), "horizontal overflow on the scene").toBeLessThanOrEqual(0);

  await page.goto("/search?q=Saltmarsh");
  await page
    .getByRole("list", { name: "Results" })
    .getByRole("link", { name: /Saltmarsh/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Saltmarsh" })).toBeVisible();
});
