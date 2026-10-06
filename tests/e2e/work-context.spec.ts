import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { uniqueEmail } from "./support/outbox";
import { addToScene, createBookWithScene, createCharacter } from "./support/story-bible";

/** Milestone 10: Back, Return to Work and Continue Writing behave differently. */

const p1 = "The tide came in slow that night, silver over the black rocks.";
const p2 = "Mara counted the lamps along the harbour wall and found one missing.";
const p3 = "You came back, said a voice behind her. She did not turn.";

async function writeParagraphs(page: Page, paragraphs: string[]) {
  await editorText(page).click();
  for (const [i, p] of paragraphs.entries()) {
    await page.keyboard.type(p);
    if (i < paragraphs.length - 1) await page.keyboard.press("Enter");
  }
  await expectSaved(page);
}

/** Puts the cursor at the end of the paragraph containing `text`, and lets the place settle. */
async function placeCursorAfter(page: Page, text: string) {
  await editorText(page).getByText(text).click();
  await page.keyboard.press("End");
  await page.waitForTimeout(500);
}

const paragraph = (page: Page, n: number) => editorText(page).locator("p").nth(n);
/** Back in the editor with the cursor restored (the author can type). */
async function backInEditor(page: Page, url: string) {
  await expect(page).toHaveURL(url);
  await expect(editorText(page)).toBeFocused();
}

const returnToWork = (page: Page) => page.getByRole("button", { name: /Return to work/ });

/** A book with Mara in its first scene; returns the scene URL (editor open). */
async function sceneWithMara(page: Page) {
  await createCharacter(page, "Mara Quinn");
  const sceneUrl = await createBookWithScene(page, "Harbour Lights");
  await addToScene(page, "Mara Quinn", { search: "Mara" });
  return sceneUrl;
}

const openMara = (page: Page) =>
  page
    .getByRole("region", { name: "Characters in this scene" })
    .getByRole("link", { name: "Mara Quinn" })
    .click();

test.describe("Milestone 10: Work Context (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "Phone layout is checked below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000);
    await signUp(page);
  });

  test("Back is browser history: one step at a time", async ({ page }) => {
    const sceneUrl = await sceneWithMara(page);
    await openMara(page);
    await expect(page.getByRole("heading", { level: 1, name: "Mara Quinn" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(sceneUrl);
    await expect(editorText(page)).toBeVisible();

    // Two steps away, Back goes one step (not to the writing).
    await openMara(page);
    await expect(page.getByRole("heading", { level: 1, name: "Mara Quinn" })).toBeVisible();
    await page.getByRole("link", { name: "Relationships" }).first().click();
    await expect(page).toHaveURL(/\/relationships$/);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Mara Quinn" })).toBeVisible();
  });

  test("Return to Work brings the author back to the exact place, from any detour", async ({
    page,
  }) => {
    const sceneUrl = await sceneWithMara(page);
    await writeParagraphs(page, [p1, p2, p3]);
    await placeCursorAfter(page, "found one missing");
    // While writing, there is nothing to return to.
    await expect(returnToWork(page)).toHaveCount(0);

    // Several detours away.
    await openMara(page);
    await expect(returnToWork(page)).toContainText("Scene 1");
    await page.getByRole("link", { name: "Relationships" }).first().click();
    await page.getByRole("link", { name: "Calendar" }).first().click();
    await expect(page).toHaveURL(/\/calendar/);

    // Surives a refresh of the detour page.
    await page.reload();
    await returnToWork(page).click();
    await backInEditor(page, sceneUrl);
    // The cursor is where it was: typing continues the second paragraph.
    await page.keyboard.type(" Again.");
    await expect(paragraph(page, 1)).toHaveText(`${p2} Again.`);
    await expectSaved(page);
    await expect(returnToWork(page)).toHaveCount(0);
  });

  test("a note written in during a detour nests: back to the note, then to the scene", async ({
    page,
  }) => {
    const sceneUrl = await sceneWithMara(page);
    await writeParagraphs(page, [p1]);

    await page.getByRole("link", { name: "Notes" }).first().click();
    await expect(page).toHaveURL(/\/notes$/);
    await page.getByRole("button", { name: "New note" }).click();
    const create = page.getByRole("dialog", { name: "New note" });
    await create.getByLabel("Title").fill("Lighthouse research");
    await create.getByRole("button", { name: "Create note" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+$/);
    const noteUrl = page.url();
    await page.getByRole("textbox", { name: "Note text" }).click();
    await page.keyboard.type("Lamps were lit at dusk.");
    await expectSaved(page);

    await page.getByRole("link", { name: "Calendar" }).first().click();
    await expect(returnToWork(page)).toContainText("Lighthouse research");
    await returnToWork(page).click();
    await expect(page).toHaveURL(noteUrl);
    // From the note, the work before it.
    await expect(returnToWork(page)).toContainText("Scene 1");
    await returnToWork(page).click();
    await expect(page).toHaveURL(sceneUrl);
    await expect(returnToWork(page)).toHaveCount(0);
  });

  test("Continue Writing resumes the manuscript at the place, on another device too", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail();
    await page.context().clearCookies();
    await signUp(page, email);
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await writeParagraphs(page, [p1, p2, p3]);
    await placeCursorAfter(page, "found one missing");
    await page.waitForTimeout(3500); // the place reaches the server

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    const resume = page.getByRole("region", { name: "Where you left off" });
    await expect(resume).toContainText("Scene 1");
    await resume.getByRole("button", { name: "Continue writing" }).click();
    await backInEditor(page, sceneUrl);
    await page.keyboard.type(" Here.");
    await expect(paragraph(page, 1)).toHaveText(`${p2} Here.`);
    await expectSaved(page);
    await page.waitForTimeout(3500);

    // Another device: a separate browser, signed in as the same author.
    const other = await browser.newContext();
    const laptop = await other.newPage();
    await signUp(laptop, email);
    await laptop
      .getByRole("region", { name: "Where you left off" })
      .getByRole("button", { name: "Continue writing" })
      .click();
    await backInEditor(laptop, sceneUrl);
    await laptop.keyboard.type(" Laptop.");
    await expect(paragraph(laptop, 1)).toHaveText(`${p2} Here. Laptop.`);
    await expectSaved(laptop);
    await other.close();
  });

  test("text changed while away: the place is found, or the author is told; nothing is overwritten", async ({
    page,
    context,
  }) => {
    const sceneUrl = await sceneWithMara(page);
    await writeParagraphs(page, [p1, p2, p3]);
    await placeCursorAfter(page, "found one missing");
    await openMara(page);

    // Elsewhere (another tab), a paragraph is added above.
    const elsewhere = await context.newPage();
    await elsewhere.goto(sceneUrl);
    await editorText(elsewhere).getByText(p1).click();
    await elsewhere.keyboard.press("Home");
    await elsewhere.keyboard.type("A new opening line.");
    await elsewhere.keyboard.press("Enter");
    await expectSaved(elsewhere);

    await returnToWork(page).click();
    await backInEditor(page, sceneUrl);
    await expect(page.getByTestId("place-notice")).toHaveCount(0);
    await page.keyboard.type(" Found.");
    await expect(paragraph(page, 2)).toHaveText(`${p2} Found.`);
    await expectSaved(page);

    // Elsewhere, that paragraph is removed entirely.
    await placeCursorAfter(page, "Found.");
    await openMara(page);
    await elsewhere.reload();
    await editorText(elsewhere).getByText("Found.").click({ clickCount: 3 });
    await elsewhere.keyboard.press("Backspace");
    await elsewhere.keyboard.press("Backspace");
    await expectSaved(elsewhere);
    await expect(editorText(elsewhere)).not.toContainText("found one missing");

    await returnToWork(page).click();
    await expect(page).toHaveURL(sceneUrl);
    // Told plainly that this isn't exactly where they were.
    await expect(page.getByTestId("place-notice")).toContainText("changed while you were away");
    // The other change stands: nothing was overwritten.
    await expect(editorText(page)).not.toContainText("found one missing");
    await expect(editorText(page)).toContainText(p3);
  });

  test("changes made during a detour stay; returning undoes nothing", async ({ page }) => {
    await sceneWithMara(page);
    await writeParagraphs(page, [p1]);
    await openMara(page);
    await page.getByRole("button", { name: "Details" }).click();
    const details = page.getByRole("dialog", { name: "Character details" });
    await details.getByLabel("Summary").fill("A lighthouse keeper's daughter.");
    await details.getByRole("button", { name: "Save" }).click();
    await expect(details).toBeHidden();

    await returnToWork(page).click();
    await expect(editorText(page)).toHaveText(p1);
    await openMara(page);
    await expect(page.getByText("A lighthouse keeper's daughter.")).toBeVisible();
  });

  test("a place that is gone is never named, and the author still has a way back", async ({
    page,
    context,
  }) => {
    const sceneUrl = await sceneWithMara(page);
    await writeParagraphs(page, [p1]);
    await page.waitForTimeout(3500);
    await openMara(page);
    await expect(returnToWork(page)).toContainText("Scene 1");

    // Elsewhere, the scene goes to the Trash.
    const elsewhere = await context.newPage();
    await elsewhere.goto(sceneUrl);
    await elsewhere.getByRole("button", { name: "Move scene to Trash" }).click();
    await elsewhere.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(elsewhere).not.toHaveURL(sceneUrl);
    await elsewhere.close();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Mara Quinn" })).toBeVisible();
    await expect(returnToWork(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page.getByRole("region", { name: "Where you left off" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("Scene 1");
  });

  test("another account in the same tab gets none of it", async ({ page }) => {
    await sceneWithMara(page);
    await writeParagraphs(page, [p1]);
    await page.waitForTimeout(3500);
    await openMara(page);
    await expect(returnToWork(page)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await signUp(page, uniqueEmail());
    await expect(returnToWork(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Where you left off" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("Scene 1");
  });
});

test("on a phone: Return to Work in the header, Continue Writing on the dashboard", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(90_000);
  await signUp(page);
  const sceneUrl = await createBookWithScene(page, "Harbour Lights");
  await writeParagraphs(page, [p1, p2]);
  await placeCursorAfter(page, "slow that night");

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Characters" }).click();
  await expect(page).toHaveURL(/\/characters$/);
  await returnToWork(page).click();
  await backInEditor(page, sceneUrl);
  await page.keyboard.type(" Phone.");
  // The cursor was at the end of the first paragraph.
  await expect(paragraph(page, 0)).toHaveText(`${p1} Phone.`);
  await expectSaved(page);
  await page.waitForTimeout(3500);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page
    .getByRole("region", { name: "Where you left off" })
    .getByRole("button", { name: "Continue writing" })
    .click();
  await expect(page).toHaveURL(sceneUrl);
  // No sideways scrolling on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
