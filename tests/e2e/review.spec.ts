import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene } from "./support/story-bible";

/**
 * Milestone 17: Review. One page for comments by state (Needs review, Open,
 * Resolved), grouped by book and scene with notes apart; resolve, reopen,
 * delete with Undo, and Open in text, where re-attaching happens.
 */

const panel = (page: Page) => page.getByRole("complementary", { name: "Comments" });
const items = (page: Page) => panel(page).getByRole("list", { name: "Comments on this text" });
const views = (page: Page) => page.getByRole("navigation", { name: "Review views" });
const view = (page: Page, name: string | RegExp) => views(page).getByRole("link", { name });
const group = (page: Page, name: string) => page.getByRole("region", { name });
const entry = (page: Page, body: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: body });
const returnToWork = (page: Page) => page.getByRole("button", { name: /Return to work/ });

async function selectLastParagraph(page: Page) {
  await editorText(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+Home");
}

async function addComment(page: Page, body: string) {
  await page.getByRole("button", { name: "Comment on selected text" }).click();
  const form = panel(page).getByRole("form", { name: "New comment" });
  await form.getByLabel("Comment").fill(body);
  await form.getByRole("button", { name: "Add comment" }).click();
  await expect(form).toBeHidden();
  await expect(items(page)).toContainText(body);
}

async function closePanel(page: Page) {
  const close = panel(page).getByRole("button", { name: "Close comments" });
  if (await close.isVisible()) await close.click();
}

/** A scene in a new book with one sentence and a comment on it. */
async function commentedScene(page: Page, book: string, sentence: string, body: string) {
  const url = await createBookWithScene(page, book);
  await editorText(page).click();
  await page.keyboard.type(sentence);
  await expectSaved(page);
  await selectLastParagraph(page);
  await addComment(page, body);
  await closePanel(page);
  return url;
}

async function commentedNote(page: Page) {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New note" });
  await dialog.getByLabel("Title").fill("Research");
  await dialog.getByRole("button", { name: "Create note" }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.type("Lamps burned whale oil.");
  await expectSaved(page);
  await page.keyboard.press("Shift+Home");
  await addComment(page, "Check the source.");
  await closePanel(page);
}

async function openReview(page: Page) {
  const link = page.getByRole("link", { name: "Review", exact: true });
  if (await link.first().isVisible()) await link.first().click();
  else await page.goto("/review");
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
}

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    "horizontal overflow",
  ).toBeLessThanOrEqual(0);

test.describe("Milestone 17: Review (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone flow is below.");

  test("lists comments by state and book, acts on them, and opens them in the text", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signUp(page);
    await openReview(page);
    await expect(view(page, /^Needs review/)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("No comments need review.")).toBeVisible();

    await commentedNote(page);
    await commentedScene(page, "Ember", "Ash fell on the roofs.", "Open question");
    // The scene being written: a comment whose sentence is then rewritten.
    const harbour = await commentedScene(
      page,
      "Harbour Lights",
      "Mara ran to the quay.",
      "Too fast here?",
    );
    await selectLastParagraph(page);
    await page.keyboard.type("Mara walked away.");
    await expectSaved(page);

    // Needs review is the default view.
    await openReview(page);
    await expect(view(page, /^Needs review/)).toHaveAttribute("aria-current", "page");
    await expect(view(page, /^Needs review/)).toHaveAccessibleName("Needs review 1 comments");
    await expect(view(page, /^Open/)).toHaveAccessibleName("Open 2 comments");
    const lost = group(page, "Book: Harbour Lights").getByRole("listitem");
    await expect(lost).toHaveAttribute("data-state", "NEEDS_REVIEW");
    await expect(lost).toContainText("Mara ran to the quay.");
    await expect(lost).toContainText("Too fast here?");
    await expect(page.getByText("Open question")).toHaveCount(0);

    // Open: a book group and the notes group, books first.
    await view(page, /^Open/).click();
    await expect(page).toHaveURL(/view=open/);
    await expect(group(page, "Book: Ember")).toContainText("Open question");
    await expect(group(page, "Notes")).toContainText("Check the source.");
    const headings = await page
      .getByRole("main")
      .getByRole("heading", { level: 2 })
      .allInnerTexts();
    expect(headings).toEqual(["Ember", "Notes"]);

    // Resolve from Review; it shows under Resolved and reopens from there.
    await entry(page, "Check the source.").getByRole("button", { name: "Resolve" }).click();
    await expect(entry(page, "Check the source.")).toHaveCount(0);
    await view(page, /^Resolved/).click();
    await expect(entry(page, "Check the source.")).toHaveAttribute("data-state", "RESOLVED");
    await entry(page, "Check the source.").getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("No resolved comments.")).toBeVisible();
    await view(page, /^Open/).click();
    await expect(entry(page, "Check the source.")).toBeVisible();

    // Delete, then Undo.
    await entry(page, "Open question").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toContainText("Comment deleted.");
    await expect(entry(page, "Open question")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(entry(page, "Open question")).toBeVisible();

    // Open in text: the scene, with the panel open on the comment and its passage.
    await entry(page, "Open question").getByRole("link", { name: "Open in text" }).click();
    await expect(page).toHaveURL(/\/scenes\/.*comment=/);
    await expect(panel(page)).toBeVisible();
    const focused = items(page).getByRole("listitem").filter({ hasText: "Open question" });
    await expect(focused).toHaveAttribute("aria-current", "true");
    await expect(editorText(page).locator(".comment-highlight")).toHaveText(
      "Ash fell on the roofs.",
    );
    // Return to Work still means the scene being written, not Review.
    await expect(returnToWork(page)).toContainText("Harbour Lights");
    await page.getByRole("link", { name: "Back to Review" }).click();
    await expect(page).toHaveURL(/\/review\?view=open/);
    await expect(view(page, /^Open/)).toHaveAttribute("aria-current", "page");

    // A comment that needs review is attached again in the editor only.
    await view(page, /^Needs review/).click();
    await entry(page, "Too fast here?").getByRole("link", { name: "Open in text" }).click();
    await expect(page).toHaveURL(new RegExp(`${new URL(harbour).pathname}\\?comment=`));
    const flagged = items(page).getByRole("listitem");
    await expect(flagged).toHaveAttribute("aria-current", "true");
    await expect(flagged).toHaveAttribute("data-state", "NEEDS_REVIEW");
    await expect(flagged).toContainText("Mara ran to the quay.");
    await selectLastParagraph(page);
    await flagged.getByRole("button", { name: "Attach to selection" }).click();
    await expect(flagged).toHaveAttribute("data-state", "OPEN");
    await expect(editorText(page)).toHaveText("Mara walked away.");
    await page.getByRole("link", { name: "Back to Review" }).click();
    await expect(page.getByText("No comments need review.")).toBeVisible();
    await expect(view(page, /^Open/)).toHaveAccessibleName("Open 3 comments");
    await noOverflow(page);
  });

  test("an unknown comment or view in the link fails safely", async ({ page }) => {
    await signUp(page);
    const url = await createBookWithScene(page, "Ember");
    await page.goto(`${url}?comment=00000000-0000-7000-8000-000000000000&from=elsewhere`);
    await expect(editorText(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Review" })).toHaveCount(0);
    for (const name of ["nonsense", "constructor"]) {
      await page.goto(`/review?view=${name}`);
      await expect(view(page, /^Needs review/)).toHaveAttribute("aria-current", "page");
    }
  });
});

test("Milestone 17: Review on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(180_000);
  await signUp(page);
  await commentedScene(page, "Ember", "Ash fell on the roofs.", "Open question");
  await page.goto("/review?view=open");
  await expect(group(page, "Book: Ember")).toContainText("Open question");
  await noOverflow(page);

  await entry(page, "Open question").getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("No open comments.")).toBeVisible();
  await view(page, /^Resolved/).click();
  await entry(page, "Open question").getByRole("button", { name: "Reopen" }).click();
  await view(page, /^Open/).click();

  await entry(page, "Open question").getByRole("link", { name: "Open in text" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(
    items(page).getByRole("listitem").filter({ hasText: "Open question" }),
  ).toHaveAttribute("aria-current", "true");
  await noOverflow(page);
  await panel(page).getByRole("button", { name: "Close comments" }).click();
  await page.getByRole("link", { name: "Back to Review" }).click();
  await expect(page).toHaveURL(/\/review\?view=open/);
  await noOverflow(page);
});
