import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import {
  binderMenu,
  createBook,
  editorText,
  expectSaved,
  keyboardMove,
  sceneTitles,
} from "./support/manuscript";

test.describe("desktop writing loop", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "Binder drag-and-drop and dialogs are exercised on desktop.",
  );

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("builds a book with optional parts, chapters and scenes", async ({ page }) => {
    await createBook(page, "The Long Night");
    await expect(page.getByText("No chapters yet")).toBeVisible();

    await page.getByRole("button", { name: "Add chapter" }).click(); // Chapter 1 (no part)
    await page.getByRole("button", { name: "Add part" }).click(); // Part 1
    await binderMenu(page, "Part 1", "Add chapter"); // Chapter 2 in Part 1
    await expect(page.getByRole("list", { name: "Chapters in Part 1" })).toContainText("Chapter 2");

    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await expect.poll(() => sceneTitles(page, "Chapter 1")).toEqual(["Scene 1", "Scene 2"]);

    // Rename a chapter inline
    await binderMenu(page, "Chapter 1", "Rename");
    await page.getByLabel("Chapter title").fill("Prologue");
    await page.getByLabel("Chapter title").press("Enter");
    await expect(page.getByRole("list", { name: "Scenes in Prologue" })).toBeVisible();

    // Keyboard reorder: move Scene 2 above Scene 1
    const handle = page
      .getByRole("list", { name: "Scenes in Prologue" })
      .getByRole("button", { name: "Drag to reorder" })
      .nth(1);
    await keyboardMove(page, handle, "Scene 2", -1);
    await expect.poll(() => sceneTitles(page, "Prologue")).toEqual(["Scene 2", "Scene 1"]);
    await page.reload();
    await expect.poll(() => sceneTitles(page, "Prologue")).toEqual(["Scene 2", "Scene 1"]);

    // Move a scene into the chapter inside the part
    await binderMenu(page, "Scene 1", "Move to…");
    const dialog = page.getByRole("dialog", { name: /Move/ });
    await dialog.getByLabel("Chapter").selectOption({ label: "Part 1 › Chapter 2" });
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect.poll(() => sceneTitles(page, "Chapter 2")).toEqual(["Scene 1"]);

    // Remove the part but keep its chapter
    await binderMenu(page, "Part 1", "Remove part, keep chapters");
    await expect(page.getByRole("list", { name: "Chapters in Part 1" })).toHaveCount(0);
    await expect.poll(() => sceneTitles(page, "Chapter 2")).toEqual(["Scene 1"]);
  });

  test("writes with autosave, word counts and persistence", async ({ page }) => {
    const bookId = await createBook(page, "Draft");
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await page.getByRole("link", { name: "Scene 1" }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${bookId}/scenes/`));

    await editorText(page).click();
    await page.keyboard.type("It was a dark and stormy night.");
    await expectSaved(page);
    await expect(page.getByTestId("word-count")).toHaveText("7 words");

    // Scene details save on change
    await page.getByLabel("Scene status").selectOption({ label: "Revised" });
    await page.getByLabel("Scene title").fill("Storm");
    await page.getByLabel("Scene title").press("Enter");

    await page.reload();
    await expect(editorText(page)).toHaveText("It was a dark and stormy night.");
    await expect(page.getByLabel("Scene title")).toHaveValue("Storm");
    await expect(page.getByLabel("Scene status")).toHaveValue("REVISED");

    // The book and library show the words
    await page.goto(`/books/${bookId}`);
    await expect(page.getByText("7 words").first()).toBeVisible();
  });

  test("saves named versions and restores them", async ({ page }) => {
    await createBook(page, "Versions");
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await page.getByRole("link", { name: "Scene 1" }).click();

    await editorText(page).click();
    await page.keyboard.type("The original opening.");
    await expectSaved(page);

    await page.getByRole("button", { name: "History" }).click();
    let dialog = page.getByRole("dialog", { name: "Scene history" });
    await dialog.getByLabel("Version name").fill("First draft");
    await dialog.getByRole("button", { name: "Save version" }).click();
    await expect(dialog.getByText("First draft")).toBeVisible();
    await page.keyboard.press("Escape");

    await editorText(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("A rewrite I regret.");
    await expectSaved(page);

    await page.getByRole("button", { name: "History" }).click();
    dialog = page.getByRole("dialog", { name: "Scene history" });
    const row = dialog.getByRole("listitem").filter({ hasText: "First draft" });
    await row.getByRole("button", { name: "Preview" }).click();
    await expect(row).toContainText("The original opening.");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toHaveText("The original opening.");

    // The replaced text was kept
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("dialog").getByText("Before restore")).toBeVisible();
  });

  test("never overwrites edits made in another tab", async ({ page, context }) => {
    await createBook(page, "Two Tabs");
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await page.getByRole("link", { name: "Scene 1" }).click();
    await expect(page).toHaveURL(/\/scenes\//);
    await expect(editorText(page)).toBeVisible();
    const url = page.url();

    const other = await context.newPage();
    await other.goto(url);
    await editorText(other).click();
    await other.keyboard.type("Written in the other tab.");
    await expectSaved(other);

    await editorText(page).click();
    await page.keyboard.type("Written here.");
    await expect(
      page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
    ).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "conflict");

    await other.reload();
    await expect(editorText(other)).toHaveText("Written in the other tab.");
  });

  test("moves work to the Trash and restores it", async ({ page }) => {
    const bookId = await createBook(page, "Trashy");
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await page.getByRole("link", { name: "Scene 1" }).click();
    await editorText(page).click();
    await page.keyboard.type("Keep me safe.");
    await expectSaved(page);

    await page.getByRole("button", { name: "Move scene to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));
    await expect(page.getByRole("list", { name: "Scenes in Chapter 1" })).toHaveCount(0);

    await page.goto("/trash");
    const item = page.getByRole("listitem").filter({ hasText: "Scene 1" });
    await expect(item).toContainText("Trashy › Chapter 1");
    await item.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("The Trash is empty")).toBeVisible();

    await page.goto(`/books/${bookId}`);
    await page.getByRole("link", { name: "Scene 1" }).click();
    await expect(editorText(page)).toHaveText("Keep me safe.");

    // Delete a whole book forever
    await page.goto(`/books/${bookId}`);
    await page.getByRole("button", { name: "Move book to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.goto("/trash");
    await page.getByRole("button", { name: "Delete forever" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByText("The Trash is empty")).toBeVisible();
  });

  test("organises books in a series and reorders them", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: "New series" }).click();
    const dialog = page.getByRole("dialog", { name: "New series" });
    await dialog.getByLabel("Title", { exact: true }).fill("Harbour Town");
    await dialog.getByRole("button", { name: "Create series" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Harbour Town" })).toBeVisible();

    for (const title of ["First Light", "Second Tide"]) {
      await page.getByRole("button", { name: "Add book" }).click();
      const d = page.getByRole("dialog", { name: "New book" });
      await expect(d.getByLabel("Series")).toHaveValue(/.+/);
      await d.getByLabel("Title", { exact: true }).fill(title);
      await d.getByRole("button", { name: "Create book" }).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await page.getByRole("link", { name: "Harbour Town" }).click();
    }

    const order = () =>
      page.getByRole("list", { name: "Books in Harbour Town" }).getByRole("link").allTextContents();
    await expect
      .poll(async () => (await order()).map((t) => t.split("Planning")[0]))
      .toEqual(["First Light", "Second Tide"]);
    const handle = page
      .getByRole("list", { name: "Books in Harbour Town" })
      .getByRole("button", { name: "Drag to reorder" })
      .nth(1);
    await keyboardMove(page, handle, "Second Tide", -1);
    await page.reload();
    await expect
      .poll(async () => (await order()).map((t) => t.split("Planning")[0]))
      .toEqual(["Second Tide", "First Light"]);
  });
});

test("writing works on a phone without horizontal scrolling", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only check");
  await signUp(page);
  await createBook(page, "Pocket Book");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
  await page.getByRole("link", { name: "Scene 1" }).click();

  await editorText(page).click();
  await page.keyboard.type("Typed on a phone.");
  await expectSaved(page);

  await page.getByRole("button", { name: "Contents" }).click();
  await expect(
    page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Scene 1" }),
  ).toBeVisible();

  for (const path of [
    page.url(),
    page.url().split("/scenes/")[0],
    "/library",
    "/identities",
    "/trash",
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
