import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { createBook } from "./support/manuscript";

/** Milestone 13: Tropes (shared, reusable, linked to books and series). */

const chips = (page: Page, title: string) => page.getByRole("list", { name: `Tropes of ${title}` });

/** "Add trope" on the current book or series page, then a choice in the list. */
async function addTrope(page: Page, title: string, type: string, choose: string | RegExp) {
  await chips(page, title).getByRole("button", { name: "Add trope" }).click();
  const dialog = page.getByRole("dialog", { name: `Add a trope to “${title}”` });
  await dialog.getByLabel("Trope", { exact: true }).fill(type);
  await dialog
    .getByRole("list", { name: "Tropes to add" })
    .getByRole("button", { name: choose })
    .click();
  await expect(dialog).toBeHidden();
}

test.describe("Milestone 13: Tropes (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone workflow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page);
  });

  test("create, reuse, use on books and a series, describe, search, trash and restore", async ({
    page,
  }) => {
    // A book: a common trope, and a new one of the author's own.
    await createBook(page, "Harbour Lights");
    const harbourUrl = page.url();
    await expect(chips(page, "Harbour Lights")).toContainText("No tropes yet.");
    await addTrope(page, "Harbour Lights", "enemies", /^Enemies to lovers\s*Common$/);
    await addTrope(page, "Harbour Lights", "Lighthouse keeper", "Create “Lighthouse keeper”");
    await expect(chips(page, "Harbour Lights").getByRole("link")).toHaveText([
      "Enemies to lovers",
      "Lighthouse keeper",
    ]);

    // Another book reuses the same trope (no longer offered as "Common").
    await createBook(page, "Flame");
    await chips(page, "Flame").getByRole("button", { name: "Add trope" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a trope to “Flame”" });
    await dialog.getByLabel("Trope", { exact: true }).fill("ENEMIES");
    const options = dialog.getByRole("list", { name: "Tropes to add" });
    // The author's trope is offered; the common one isn't offered again.
    await expect(options.getByRole("button")).toHaveText(["Enemies to lovers", "Create “ENEMIES”"]);
    await options.getByRole("button", { name: "Enemies to lovers" }).click();
    await expect(chips(page, "Flame").getByRole("link")).toHaveText(["Enemies to lovers"]);

    // A series.
    await page.goto("/library");
    await page.getByRole("button", { name: "New series" }).click();
    const seriesDialog = page.getByRole("dialog", { name: "New series" });
    await seriesDialog.getByLabel("Title", { exact: true }).fill("Crown of Ash");
    await seriesDialog.getByRole("button", { name: "Create series" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Crown of Ash" })).toBeVisible();
    await addTrope(page, "Crown of Ash", "Slow burn", /^Slow burn\s*Common$/);
    await expect(chips(page, "Crown of Ash").getByRole("link")).toHaveText(["Slow burn"]);

    // The Tropes page: one trope each, used where it was added.
    await page.goto("/tropes");
    const list = page.getByRole("list", { name: "Tropes" });
    await expect(list.getByRole("link")).toHaveCount(3);
    await expect(list.getByRole("link", { name: /Enemies to lovers/ })).toContainText(
      "Used 2 times",
    );
    await list.getByRole("link", { name: /Enemies to lovers/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Enemies to lovers" })).toBeVisible();
    const usedIn = page.getByRole("list", { name: "Used in" });
    await expect(usedIn.getByRole("link")).toHaveText(["Harbour Lights", "Flame"], {
      useInnerText: true,
    });

    // Describe it; the earlier description is kept.
    await page.getByLabel("What it means in your books").fill("They start as rivals.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.getByLabel("What it means in your books").fill("They start as bitter rivals.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Earlier versions" }).click();
    await expect(page.getByRole("list", { name: "Earlier values" })).toContainText(
      "They start as rivals.",
    );
    await page.keyboard.press("Escape");

    // Search finds it.
    await page.goto("/search?q=lighthouse");
    await expect(page.getByRole("list", { name: "Results" })).toContainText("Lighthouse keeper");

    // Trash: it leaves the books; restoring brings it back.
    await page.goto("/tropes");
    await page
      .getByRole("list", { name: "Tropes" })
      .getByRole("link", { name: /Lighthouse/ })
      .click();
    await page.getByRole("button", { name: "Move trope to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/tropes$/);
    await page.goto(harbourUrl);
    await expect(chips(page, "Harbour Lights").getByRole("link")).toHaveText(["Enemies to lovers"]);
    await page.goto("/trash");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Lighthouse keeper" })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByRole("listitem").filter({ hasText: "Lighthouse keeper" })).toHaveCount(
      0,
    );
    await page.goto(harbourUrl);
    await expect(chips(page, "Harbour Lights").getByRole("link")).toHaveText([
      "Enemies to lovers",
      "Lighthouse keeper",
    ]);

    // Removing a trope from a book leaves the trope.
    await page.getByRole("button", { name: "Remove trope Lighthouse keeper" }).click();
    await expect(chips(page, "Harbour Lights").getByRole("link")).toHaveText(["Enemies to lovers"]);
    await page.goto("/tropes");
    await expect(page.getByRole("list", { name: "Tropes" })).toContainText("Lighthouse keeper");
  });
});

test("Milestone 13: tropes on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(120_000);
  await signUp(page);
  await createBook(page, "Pocket");
  const bookUrl = page.url();
  await addTrope(page, "Pocket", "Found", /^Found family\s*Common$/);
  await addTrope(page, "Pocket", "A very long trope name that has to wrap", /^Create/);
  await expect(chips(page, "Pocket").getByRole("link")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove trope Found family" }).click();
  await expect(chips(page, "Pocket").getByRole("link")).toHaveCount(1);

  await chips(page, "Pocket").getByRole("link").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "A very long trope name that has to wrap" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Used in" })).toContainText("Pocket");

  for (const path of [bookUrl, page.url(), "/tropes"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
