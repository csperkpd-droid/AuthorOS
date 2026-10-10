import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene } from "./support/story-bible";

/**
 * Milestone 16: comments with external anchors. Comments sit beside the
 * text, follow their passage, and are flagged (never moved) when it changes.
 */

const panel = (page: Page) => page.getByRole("complementary", { name: "Comments" });
const items = (page: Page) => panel(page).getByRole("list", { name: "Comments on this text" });
const highlight = (page: Page) => editorText(page).locator(".comment-highlight");

/** Selects the last paragraph of the text (the cursor's line, after Ctrl+End). */
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

async function openPanel(page: Page) {
  if (await panel(page).isVisible()) return;
  await page.getByRole("button", { name: /^Comments:/ }).click();
  await expect(panel(page)).toBeVisible();
}

/** A scene with two paragraphs, saved; returns its URL. */
async function sceneWithText(page: Page) {
  const url = await createBookWithScene(page, "Harbour Lights");
  await editorText(page).click();
  await page.keyboard.type("The storm came in at dusk.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mara ran to the quay.");
  await expectSaved(page);
  return url;
}

test.describe("Milestone 16: comments (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone flow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(150_000);
    await signUp(page);
  });

  test("a comment follows its passage, is flagged when it is rewritten, and is attached again by the author", async ({
    page,
  }) => {
    const url = await sceneWithText(page);
    await selectLastParagraph(page);
    await addComment(page, "Too fast here?");
    await expect(highlight(page)).toHaveText("Mara ran to the quay.");

    // Paragraphs typed above: the comment still points at the same sentence.
    await editorText(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("A new opening.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Another paragraph.");
    await page.keyboard.press("Enter");
    await expectSaved(page);
    await page.reload();
    await expect(highlight(page)).toHaveText("Mara ran to the quay.");
    await openPanel(page);
    await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "OPEN");

    // The sentence rewritten: Needs review, nothing moved to other text.
    await selectLastParagraph(page);
    await page.keyboard.type("Mara walked away.");
    await expectSaved(page);
    await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "NEEDS_REVIEW");
    await expect(items(page)).toContainText("Mara ran to the quay.");
    await expect(highlight(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("review-count")).toHaveAccessibleName("1 comment needs review");

    // The author attaches it to the new sentence.
    await openPanel(page);
    await selectLastParagraph(page);
    await items(page).getByRole("button", { name: "Attach to selection" }).click();
    await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "OPEN");
    await expect(highlight(page)).toHaveText("Mara walked away.");
    await page.reload();
    await expect(page.getByTestId("review-count")).toHaveCount(0);

    // Resolve (hidden by default), reopen.
    await openPanel(page);
    await items(page).getByRole("button", { name: "Resolve" }).click();
    await expect(items(page)).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Show resolved (1)" }).click();
    await items(page).getByRole("button", { name: "Reopen" }).click();
    await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "OPEN");

    // Delete, then Undo.
    await items(page).getByRole("button", { name: "Delete" }).click();
    await expect(panel(page).getByRole("status")).toContainText("Comment deleted.");
    await expect(items(page)).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Undo" }).click();
    await expect(items(page)).toContainText("Too fast here?");

    // Comments are never in the text.
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
    await page.goto(url);
    await expect(editorText(page)).not.toContainText("Too fast here?");

    // Manuscript exports carry no comments.
    await page.goto("/export");
    await page.getByLabel("Markdown manuscript (.md)").check();
    const md = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const text = await readFile((await (await md).path())!, "utf8");
    expect(text).toContain("Mara walked away.");
    expect(text).not.toContain("Too fast here?");
  });

  test("notes take comments too", async ({ page }) => {
    await page.goto("/notes");
    await page.getByRole("button", { name: "New note" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New note" });
    await dialog.getByLabel("Title").fill("Research");
    await dialog.getByRole("button", { name: "Create note" }).click();
    await expect(page).toHaveURL(/\/notes\//);
    const body = page.getByRole("textbox", { name: "Note text" });
    await body.click();
    await page.keyboard.type("Lamps burned whale oil.");
    await expectSaved(page);
    await page.keyboard.press("Shift+Home");
    await addComment(page, "Check the source.");
    await expect(body.locator(".comment-highlight")).toHaveText("Lamps burned whale oil.");
  });
});

test("Milestone 16: comments on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(150_000);
  await signUp(page);
  await sceneWithText(page);
  await selectLastParagraph(page);
  await addComment(page, "Too fast here?");
  await expect(highlight(page)).toHaveText("Mara ran to the quay.");
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow(), "horizontal overflow with the comments sheet").toBeLessThanOrEqual(0);
  const box = await panel(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

  // Rewritten: flagged; resolved and reopened on the small screen.
  await panel(page).getByRole("button", { name: "Close comments" }).click();
  await selectLastParagraph(page);
  await page.keyboard.type("Mara walked away.");
  await expectSaved(page);
  await openPanel(page);
  await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "NEEDS_REVIEW");
  await items(page).getByRole("button", { name: "Resolve" }).click();
  await panel(page).getByRole("button", { name: "Show resolved (1)" }).click();
  await items(page).getByRole("button", { name: "Reopen" }).click();
  await expect(items(page).getByRole("listitem")).toHaveAttribute("data-state", "NEEDS_REVIEW");
  expect(await overflow()).toBeLessThanOrEqual(0);
});
