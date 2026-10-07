import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { createBookWithScene } from "./support/story-bible";

/**
 * Milestone 14: beats are story objects, and a placement's validity follows
 * its scene, shown as calm observations. Nothing is removed for the author.
 */

const post = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");

/** A series "Crown of Ash" with the book "Ember" (one scene) in it; returns the URLs. */
async function seriesWithBook(page: Page) {
  const sceneUrl = await createBookWithScene(page, "Ember");
  const bookUrl = sceneUrl.split("/scenes/")[0];
  await page.goto("/library");
  await page.getByRole("button", { name: "New series" }).click();
  const seriesDialog = page.getByRole("dialog", { name: "New series" });
  await seriesDialog.getByLabel("Title", { exact: true }).fill("Crown of Ash");
  await seriesDialog.getByRole("button", { name: "Create series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Crown of Ash" })).toBeVisible();
  const seriesUrl = page.url();
  await setSeries(page, bookUrl, "Crown of Ash");
  return { sceneUrl, bookUrl, seriesUrl };
}

/**
 * Changes the book's series. With `reviewTitle`, the change is reviewed
 * first (Change Impact) and the review is returned unsaved; without, the
 * change has nothing to review and is saved directly.
 */
async function setSeries(page: Page, bookUrl: string, series: string, reviewTitle?: string) {
  await page.goto(bookUrl);
  const details = page.getByRole("dialog", { name: "Book details" });
  await expect(async () => {
    await page.getByRole("button", { name: "Details" }).click();
    await expect(details).toBeVisible({ timeout: 2000 });
  }).toPass();
  await details.getByLabel("Series").selectOption({ label: series });
  await details.getByRole("button", { name: "Save" }).click();
  if (!reviewTitle) {
    await expect(details).toBeHidden();
    return null;
  }
  const review = page.getByRole("dialog", { name: reviewTitle });
  await expect(review).toBeVisible();
  return review;
}

/** A whole-series structure with one beat, placed in the book's scene. */
async function seriesStructure(page: Page, seriesUrl: string) {
  await page.goto(seriesUrl);
  await page.getByRole("button", { name: "New structure" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New structure" });
  await dialog.getByLabel("For").selectOption({ label: "Crown of Ash (whole series)" });
  await dialog.getByLabel("Template").selectOption({ label: "No template (add your own beats)" });
  await dialog.getByLabel("Name").fill("Series plot");
  await dialog.getByRole("button", { name: "Create structure" }).click();
  await expect(page.getByLabel("Structure name")).toHaveValue("Series plot");
  const structureUrl = page.url();

  await page.getByRole("button", { name: "Add beat" }).click();
  const beat = page.getByRole("dialog", { name: "New beat" });
  await beat.getByLabel("Beat").fill("Midpoint");
  await beat.getByLabel("What happens").fill("The truth comes out.");
  await beat.getByRole("button", { name: "Add beat" }).click();
  await expect(beat).toBeHidden();
  const saved = post(page);
  await page.getByLabel("Place Midpoint in a scene").selectOption({ label: "Chapter 1 › Scene 1" });
  await saved;
  await expect(
    page.getByRole("list", { name: "Scenes for Midpoint" }).getByRole("link", { name: /Scene 1/ }),
  ).toBeVisible();
  return structureUrl;
}

const card = (page: Page) => page.getByRole("article", { name: "Midpoint" });
const notes = (page: Page) =>
  page.getByRole("list", { name: "Placements to look at for Midpoint" });

test.describe("Milestone 14: beats and validity (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone flow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(150_000);
    await signUp(page);
  });

  test("a placement that no longer fits is kept, can be kept intentionally, and comes back", async ({
    page,
  }) => {
    const { sceneUrl, bookUrl, seriesUrl } = await seriesWithBook(page);
    const structureUrl = await seriesStructure(page, seriesUrl);
    await expect(page.getByText("1 of 1 beats placed")).toBeVisible();
    await expect(card(page)).toContainText("The truth comes out.");

    // The book leaves the series: the review says the placement is kept.
    const review = await setSeries(
      page,
      bookUrl,
      "Standalone (no series)",
      "Make “Ember” a standalone book?",
    );
    await expect(review!).toContainText("Kept, marked as no longer fitting");
    await review!.getByRole("button", { name: "Save" }).click();
    await expect(review!).toBeHidden();

    // A calm observation; nothing was removed.
    await page.goto(structureUrl);
    await expect(notes(page)).toContainText("No longer fits.");
    await expect(notes(page)).toContainText("Nothing was removed");
    await expect(notes(page)).toContainText("“Scene 1” is now in “Ember”");
    await expect(page.getByText("0 of 1 beats placed")).toBeVisible();
    await expect(card(page)).toContainText("The truth comes out.");

    // Keep it intentionally; it lasts after a reload.
    await notes(page).getByRole("button", { name: "Keep intentionally" }).click();
    const keep = page.getByRole("dialog", { name: "Keep this placement?" });
    await keep.getByLabel("Why (optional)").fill("The epilogue echoes it.");
    await keep.getByRole("button", { name: "Keep intentionally" }).click();
    await expect(keep).toBeHidden();
    await page.reload();
    await expect(notes(page)).toContainText("Kept intentionally.");
    await expect(notes(page)).toContainText("The epilogue echoes it.");
    await expect(notes(page).getByRole("button", { name: "Keep intentionally" })).toHaveCount(0);
    await expect(page.getByText("1 of 1 beats placed")).toBeVisible();

    // Back in the series: the placement is simply current again.
    await setSeries(page, bookUrl, "Crown of Ash");
    await page.goto(structureUrl);
    await expect(notes(page)).toHaveCount(0);
    await expect(
      page
        .getByRole("list", { name: "Scenes for Midpoint" })
        .getByRole("link", { name: /Scene 1/ }),
    ).toBeVisible();

    // The scene in the Trash: Potentially Stale, kept; restored: Current.
    await page.goto(sceneUrl);
    await page.getByRole("button", { name: "Move scene to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(new RegExp(`${bookUrl}$`));
    await page.goto(structureUrl);
    await expect(notes(page)).toContainText("Scene in the Trash.");
    await expect(notes(page)).toContainText("returns to normal if you restore the scene");
    await page.goto("/trash");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Scene 1" })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByText("The Trash is empty")).toBeVisible();
    await page.goto(structureUrl);
    await expect(notes(page)).toHaveCount(0);
    await expect(
      page
        .getByRole("list", { name: "Scenes for Midpoint" })
        .getByRole("link", { name: /Scene 1/ }),
    ).toBeVisible();
  });

  test("a beat is found by search and opens at its structure", async ({ page }) => {
    const { seriesUrl } = await seriesWithBook(page);
    const structureUrl = await seriesStructure(page, seriesUrl);
    await page.goto("/search?q=Midpoint");
    const results = page.getByRole("list", { name: "Results" });
    await results.getByRole("link", { name: /Midpoint/ }).click();
    await expect(page).toHaveURL(new RegExp(`${structureUrl}#beat-`));
    await expect(card(page)).toBeInViewport();

    // Its description history is on the beat itself.
    await page.getByRole("button", { name: "Actions for Midpoint" }).click();
    await page.getByRole("menuitem", { name: "Edit beat" }).click();
    const edit = page.getByRole("dialog", { name: "Edit beat" });
    await edit.getByLabel("What happens").fill("The truth comes out at last.");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await page.getByRole("button", { name: "Actions for Midpoint" }).click();
    await page.getByRole("menuitem", { name: "Edit beat" }).click();
    await edit.getByRole("button", { name: "Earlier descriptions" }).click();
    await expect(page.getByRole("list", { name: "Earlier values" })).toContainText(
      "The truth comes out.",
    );
  });
});

test("Milestone 14: beats and validity on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(150_000);
  await signUp(page);
  const { bookUrl, seriesUrl } = await seriesWithBook(page);
  const structureUrl = await seriesStructure(page, seriesUrl);

  const review = await setSeries(
    page,
    bookUrl,
    "Standalone (no series)",
    "Make “Ember” a standalone book?",
  );
  await review!.getByRole("button", { name: "Save" }).click();
  await expect(review!).toBeHidden();
  await page.goto(structureUrl);
  await expect(notes(page)).toContainText("No longer fits.");
  await notes(page).getByRole("button", { name: "Keep intentionally" }).click();
  const keep = page.getByRole("dialog", { name: "Keep this placement?" });
  await keep.getByRole("button", { name: "Keep intentionally" }).click();
  await expect(keep).toBeHidden();
  await page.reload();
  await expect(notes(page)).toContainText("Kept intentionally.");

  await page.goto("/search?q=Midpoint");
  await page
    .getByRole("list", { name: "Results" })
    .getByRole("link", { name: /Midpoint/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`${structureUrl}#beat-`));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow on the structure").toBeLessThanOrEqual(0);
});
