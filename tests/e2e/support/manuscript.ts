import { expect, type Locator, type Page } from "@playwright/test";

/** Creates a standalone book from the Library and lands on its page. */
export async function createBook(page: Page, title: string) {
  await page.goto("/library");
  await page.getByRole("button", { name: "New book" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Create book" }).click();
  // The first visit to a book page can be slow while the dev server compiles it.
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({
    timeout: 15_000,
  });
  return page.url().split("/books/")[1];
}

/** Opens the actions menu of a binder row and picks an item. */
export async function binderMenu(page: Page, rowTitle: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${rowTitle}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

export async function sceneTitles(page: Page, chapter: string) {
  return page
    .getByRole("list", { name: `Scenes in ${chapter}` })
    .getByRole("link")
    .allTextContents();
}

export function editorText(page: Page) {
  return page.getByRole("textbox", { name: "Scene text" });
}

export async function expectSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", {
    timeout: 10_000,
  });
}

/**
 * Keyboard drag-and-drop, the way a keyboard or screen-reader user does it:
 * Space to lift, arrows to move, Space to drop. Waits on the live-region
 * announcements at each step, then for the save request.
 */
export async function keyboardMove(page: Page, handle: Locator, name: string, steps: number) {
  const announcer = page.locator("[id^=DndLiveRegion]");
  // Right after a load or refresh the handle may not be hydrated yet; without
  // a "Picked up" announcement no drag started, so lifting again is safe.
  await expect(async () => {
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(announcer.filter({ hasText: `Picked up ${name}.` })).toHaveCount(1, {
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.keyboard.press(steps < 0 ? "ArrowUp" : "ArrowDown");
  }
  await expect(announcer.filter({ hasText: `${name} moved to` })).toHaveCount(1);
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await page.keyboard.press("Space");
  await expect(announcer.filter({ hasText: `${name} dropped at` })).toHaveCount(1);
  await saved;
}

/** Switches the "Writing as" identity and waits until the choice is saved. */
export async function switchIdentity(page: Page, label: string) {
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByLabel("Writing as").selectOption({ label });
  await saved;
  // Other requests (e.g. the one-time time-zone detection) may also POST:
  // wait until everything has settled.
  await page.waitForLoadState("networkidle");
}
