import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import {
  createBook,
  editorText,
  expectSaved,
  keyboardMove,
  sceneTitles,
} from "./support/manuscript";

/** Milestone 12: Story Time (scenes and events in story order). */

/** A book with three scenes in Chapter 1; returns the book URL. */
async function bookWithThreeScenes(page: Page, title: string) {
  await createBook(page, title);
  const bookUrl = page.url();
  await page.getByRole("button", { name: "Add chapter" }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
    await expect.poll(() => sceneTitles(page, "Chapter 1")).toHaveLength(i);
  }
  return bookUrl;
}

async function openScene(page: Page, bookUrl: string, title: string) {
  await page.goto(bookUrl);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/scenes\//);
  await expect(page.getByTestId("scene-story-time")).toBeVisible();
}

const when = (page: Page) => page.getByTestId("scene-story-time");

/** "Place in story time" (or "Move in story time") on the scene page. */
async function place(page: Page, after: string, label?: string) {
  await page
    .getByRole("region", { name: "Story time" })
    .getByRole("button", { name: /(Place|Move) in story time/ })
    .click();
  const dialog = page.getByRole("dialog", { name: /in story time$/ });
  await dialog.getByLabel("Happens after").selectOption({ label: after });
  if (label !== undefined) await dialog.getByLabel("Story time (optional)").fill(label);
  await dialog.getByRole("button", { name: "Place in story time" }).click();
  await expect(dialog).toBeHidden();
}

const storyOrder = (page: Page) =>
  page
    .getByRole("list", { name: "Story order" })
    .getByTestId("timeline-entry")
    .locator("a")
    .allTextContents();

test.describe("Milestone 12: Story Time (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone workflow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page);
  });

  test("places scenes and events in story order, apart from reading order and the text", async ({
    page,
  }) => {
    const bookUrl = await bookWithThreeScenes(page, "Harbour Lights");

    // Scene 1: written, then placed. Nothing is placed for the author.
    await openScene(page, bookUrl, "Scene 1");
    await expect(when(page)).toContainText("Not placed in the story’s timeline yet");
    await editorText(page).click();
    await page.keyboard.type("On the second day the lamps went out.");
    await expectSaved(page);
    await place(page, "At the very start", "Day 2");
    await expect(when(page)).toContainText("Story time:Day 2· 1st in story order");

    // Scene 2 is a flashback: first in the story, second in the book.
    await openScene(page, bookUrl, "Scene 2");
    await place(page, "At the very start", "Ten years earlier");
    await expect(when(page)).toContainText("Ten years earlier· 1st in story order");

    // The timeline: story order, with reading order beside it.
    await page.getByRole("link", { name: "Open timeline" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Harbour Lights" })).toBeVisible();
    await expect.poll(() => storyOrder(page)).toEqual(["Scene 2", "Scene 1"]);
    const story = page.getByRole("list", { name: "Story order" });
    await expect(story.getByTestId("timeline-entry").first()).toContainText("#2 in reading order");
    const notPlaced = page.getByRole("list", { name: "Scenes not placed yet" });
    await expect(notPlaced).toContainText("Scene 3");

    // An event between them.
    await page.getByRole("button", { name: "Add event" }).click();
    const add = page.getByRole("dialog", { name: "Add a timeline event" });
    await add.getByLabel("Event").fill("The shipwreck");
    await add.getByLabel("Story time (optional)").fill("Day 1");
    await add.getByLabel("Happens after").selectOption({ label: "Scene 2 (Ten years earlier)" });
    await add.getByRole("button", { name: "Add event" }).click();
    await expect(add).toBeHidden();
    await expect.poll(() => storyOrder(page)).toEqual(["Scene 2", "The shipwreck", "Scene 1"]);

    // Place Scene 3 from the list, then move it by button and by keyboard drag.
    await notPlaced.getByRole("button", { name: "Place Scene 3" }).click();
    const dialog = page.getByRole("dialog", { name: "Place “Scene 3” in story time" });
    await dialog.getByLabel("Story time (optional)").fill("Day 3");
    await dialog.getByRole("button", { name: "Place in story time" }).click();
    await expect
      .poll(() => storyOrder(page))
      .toEqual(["Scene 2", "The shipwreck", "Scene 1", "Scene 3"]);
    await expect(page.getByText("Every scene has a place in story time.")).toBeVisible();
    await page.getByRole("button", { name: "Move Scene 3 earlier in story time" }).click();
    await expect
      .poll(() => storyOrder(page))
      .toEqual(["Scene 2", "The shipwreck", "Scene 3", "Scene 1"]);
    const handle = story.getByRole("button", { name: "Drag to reorder" }).nth(1);
    await keyboardMove(page, handle, "The shipwreck", -1);
    await expect
      .poll(() => storyOrder(page))
      .toEqual(["The shipwreck", "Scene 2", "Scene 3", "Scene 1"]);
    await page.reload();
    await expect
      .poll(() => storyOrder(page))
      .toEqual(["The shipwreck", "Scene 2", "Scene 3", "Scene 1"]);

    // The event's own page: details with history, Trash and back.
    await story.getByRole("link", { name: "The shipwreck" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The shipwreck" })).toBeVisible();
    await page.getByLabel("What happens").fill("The Marigold goes down off the point.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.getByRole("button", { name: "Move event to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/timeline\/[0-9a-f-]+$/);
    await expect.poll(() => storyOrder(page)).toEqual(["Scene 2", "Scene 3", "Scene 1"]);
    await page.goto("/trash");
    await page
      .getByRole("listitem")
      .filter({ hasText: "The shipwreck" })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByRole("listitem").filter({ hasText: "The shipwreck" })).toHaveCount(0);

    // Reading order and the text are exactly as before.
    await page.goto(bookUrl);
    await expect
      .poll(() => sceneTitles(page, "Chapter 1"))
      .toEqual(["Scene 1", "Scene 2", "Scene 3"]);
    await openScene(page, bookUrl, "Scene 1");
    await expect(editorText(page)).toHaveText("On the second day the lamps went out.");
    await expect(when(page)).toContainText("Day 2· 4th in story order");

    // Every change is in the scene's history.
    await page.getByRole("button", { name: "Story time changes" }).click();
    const history = page.getByRole("list", { name: "Changes to this scene’s story time" });
    await expect(history).toContainText("Placed in story time at the start (“Day 2”)");
    await expect(history.getByRole("listitem")).toHaveCount(1);
  });

  test("moving a book into a series is reviewed before its Story Time moves", async ({ page }) => {
    const bookUrl = await bookWithThreeScenes(page, "Ember");
    await openScene(page, bookUrl, "Scene 1");
    await place(page, "At the very start", "Day 1");

    await page.goto("/library");
    await page.getByRole("button", { name: "New series" }).click();
    const seriesDialog = page.getByRole("dialog", { name: "New series" });
    await seriesDialog.getByLabel("Title", { exact: true }).fill("Crown of Ash");
    await seriesDialog.getByRole("button", { name: "Create series" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Crown of Ash" })).toBeVisible();

    await page.goto(bookUrl);
    const details = page.getByRole("dialog", { name: "Book details" });
    await expect(async () => {
      await page.getByRole("button", { name: "Details" }).click();
      await expect(details).toBeVisible({ timeout: 2000 });
    }).toPass();
    await details.getByLabel("Series").selectOption({ label: "Crown of Ash" });
    await details.getByRole("button", { name: "Save" }).click();
    const review = page.getByRole("dialog", { name: "Add “Ember” to “Crown of Ash”?" });
    await expect(review).toContainText("Scenes and events in Story Time");
    await expect(review).toContainText("This will affect 1 item: 1 item in story time.");
    // Nothing changes until the author approves.
    await review.getByRole("button", { name: "Cancel" }).click();
    await page.goto("/timeline");
    await expect(page.getByRole("list", { name: "Timelines" })).toContainText("Ember");

    await page.goto(bookUrl);
    await expect(async () => {
      await page.getByRole("button", { name: "Details" }).click();
      await expect(details).toBeVisible({ timeout: 2000 });
    }).toPass();
    await details.getByLabel("Series").selectOption({ label: "Crown of Ash" });
    await details.getByRole("button", { name: "Save" }).click();
    await review.getByRole("button", { name: "Save" }).click();
    await expect(review).toBeHidden();
    await page.goto("/timeline");
    const list = page.getByRole("list", { name: "Timelines" });
    await list.getByRole("link", { name: /Crown of Ash/ }).click();
    await expect.poll(() => storyOrder(page)).toEqual(["Scene 1"]);
  });
});

test("Milestone 12: Story Time on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(120_000);
  await signUp(page);
  const bookUrl = await bookWithThreeScenes(page, "Pocket");
  await openScene(page, bookUrl, "Scene 2");
  await place(page, "At the very start", "Day 1");
  await openScene(page, bookUrl, "Scene 1");
  await place(page, "Scene 2 (Day 1)", "Day 2");

  await page.getByRole("link", { name: "Open timeline" }).click();
  await expect.poll(() => storyOrder(page)).toEqual(["Scene 2", "Scene 1"]);
  // The same moves by touch, with the buttons.
  await page.getByRole("button", { name: "Move Scene 1 earlier in story time" }).click();
  await expect.poll(() => storyOrder(page)).toEqual(["Scene 1", "Scene 2"]);
  await page
    .getByRole("list", { name: "Scenes not placed yet" })
    .getByRole("button", { name: "Place Scene 3" })
    .click();
  await page
    .getByRole("dialog", { name: "Place “Scene 3” in story time" })
    .getByRole("button", { name: "Place in story time" })
    .click();
  await expect.poll(() => storyOrder(page)).toEqual(["Scene 1", "Scene 2", "Scene 3"]);

  for (const path of [page.url(), "/timeline", bookUrl]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
