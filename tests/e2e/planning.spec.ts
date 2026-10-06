import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { addToScene, createBookWithScene, createCharacter } from "./support/story-bible";

const post = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");

/** Today in the browser's time zone (the app adopts it on first visit). */
const localToday = (page: Page) => page.evaluate(() => new Date().toLocaleDateString("en-CA"));

async function addSceneToBook(page: Page) {
  let saved = post(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await saved;
  saved = post(page);
  await page.getByRole("button", { name: "Add scene to Chapter 1" }).click();
  await saved;
}

test.describe("Milestone 4", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop; phone layout is checked below.");

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("a series-long romance arc spans books and shows in the Romance Center", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/library");
    await page.getByRole("button", { name: "New series" }).click();
    const seriesDialog = page.getByRole("dialog", { name: "New series" });
    await seriesDialog.getByLabel("Title", { exact: true }).fill("Crown of Ash");
    await seriesDialog.getByRole("button", { name: "Create series" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Crown of Ash" })).toBeVisible();
    const seriesUrl = page.url();
    for (const title of ["Ember", "Flame"]) {
      await page.goto(seriesUrl);
      await page.getByRole("button", { name: "Add book" }).click();
      const d = page.getByRole("dialog", { name: "New book" });
      await d.getByLabel("Title", { exact: true }).fill(title);
      await d.getByRole("button", { name: "Create book" }).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await addSceneToBook(page);
    }

    await createCharacter(page, "Kael", undefined, { series: "Crown of Ash" });
    await createCharacter(page, "Elara", undefined, { series: "Crown of Ash" });
    await page.getByRole("button", { name: "Add relationship" }).click();
    const rel = page.getByRole("dialog", { name: "New relationship" });
    await rel.getByLabel("Elara and…").selectOption({ label: "Kael" });
    await rel.getByLabel("Type").fill("Romance");
    await rel.getByRole("button", { name: "Create relationship" }).click();
    await expect(rel).toBeHidden();

    // Start the arc from the series' Romance Center.
    await page.goto(seriesUrl);
    await page.getByRole("link", { name: "Romance Center" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Romance Center" })).toBeVisible();
    await page.getByRole("button", { name: "New romance arc" }).click();
    const create = page.getByRole("dialog", { name: "New structure" });
    await expect(create.getByLabel("For")).toHaveValue(/^series:/);
    await create.getByLabel("Relationship").selectOption({ index: 1 });
    await create.getByLabel("Template").selectOption("");
    await create.getByLabel("Name").fill("Kael + Elara");
    await create.getByRole("button", { name: "Create structure" }).click();
    await expect(page.getByLabel("Structure name")).toHaveValue("Kael + Elara");
    const arcUrl = page.url();

    for (const [beat, book] of [
      ["Meet", "Book 1: Ember"],
      ["First Kiss", "Book 2: Flame"],
    ]) {
      await page.getByRole("button", { name: "Add beat" }).click();
      const d = page.getByRole("dialog", { name: "New beat" });
      await d.getByLabel("Beat").fill(beat);
      await d.getByLabel("Planned for").selectOption({ label: book });
      await d.getByRole("button", { name: "Add beat" }).click();
      await expect(page.getByRole("article", { name: beat })).toBeVisible();
    }
    const saved = post(page);
    await page
      .getByLabel("Place Meet in a scene")
      .selectOption({ label: "Book 1 · Chapter 1 › Scene 1" });
    await saved;
    await expect(
      page.getByRole("list", { name: "Scenes for Meet" }).getByRole("link", { name: /Scene 1/ }),
    ).toBeVisible();

    // One book at a time.
    await page.getByRole("button", { name: "Book 2: Flame" }).click();
    await expect(page.getByRole("article", { name: "First Kiss" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Meet" })).toHaveCount(0);

    // The progression across the series.
    await page.goto(`${seriesUrl}/romance`);
    const couple = page.getByRole("region", { name: /Kael & Elara|Elara & Kael/ });
    await expect(couple.getByRole("list", { name: /in Ember$/ })).toContainText("Meet");
    await expect(couple.getByRole("list", { name: /in Flame$/ })).toContainText("First Kiss");
    await expect(couple.getByLabel("Placed in a scene")).toHaveCount(1);

    // Save it as a template for the next series.
    await page.goto(arcUrl);
    await page.getByRole("button", { name: "Save as template" }).click();
    const t = page.getByRole("dialog", { name: "Save as template" });
    await t.getByLabel("Template name").fill("Slow-burn duet");
    await t.getByRole("button", { name: "Save template" }).click();
    await expect(t.getByRole("status")).toContainText("Template saved");
    await page.goto("/structure/templates");
    await expect(
      page.getByRole("list", { name: "Templates" }).first().getByText("Slow-burn duet"),
    ).toBeVisible();

    // Ember leaves the series: reviewed first, nothing orphaned.
    await page.goto(seriesUrl);
    await page.getByRole("link", { name: /Ember/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Ember" })).toBeVisible();
    const details = page.getByRole("dialog", { name: "Book details" });
    await expect(async () => {
      await page.getByRole("button", { name: "Details" }).click();
      await expect(details).toBeVisible({ timeout: 2000 });
    }).toPass();
    await details.getByLabel("Series").selectOption({ label: "Standalone (no series)" });
    await details.getByRole("button", { name: "Save" }).click();
    const review = page.getByRole("dialog", { name: "Make “Ember” a standalone book?" });
    await expect(review).toContainText("This will affect 2 items: 1 beat, 1 beat placement.");
    await review.getByRole("button", { name: "Save" }).click();
    await expect(review).toBeHidden();
    await page.goto(arcUrl);
    await expect(page.getByRole("article", { name: "Meet" })).toContainText("Not placed");
  });

  test("changing a book's pen name reviews and moves its story data", async ({ page }) => {
    await page.goto("/identities");
    await page.getByRole("button", { name: "New pen name" }).click();
    const pen = page.getByRole("dialog", { name: "New pen name" });
    await pen.getByLabel("Name").fill("Rose Hart");
    await pen.getByRole("button", { name: "Create pen name" }).click();
    await expect(pen).toBeHidden();

    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await addToScene(page, "Mara Quinn", { create: true });

    await page.goto(sceneUrl.split("/scenes/")[0]);
    await page.getByRole("button", { name: "Change pen name…" }).click();
    let dialog = page.getByRole("dialog", { name: /Change the pen name/ });
    await dialog.getByLabel("New pen name").selectOption({ label: "Rose Hart" });
    await dialog.getByRole("button", { name: "Review impact" }).click();
    dialog = page.getByRole("dialog", { name: "Move “Harbour Lights” to Rose Hart?" });
    const affected = dialog.getByRole("list", { name: "What will this affect?" });
    await expect(affected).toContainText("Characters (1)");
    await expect(dialog.getByRole("status")).toContainText("1 book, 1 character");
    await expect(dialog.getByRole("link", { name: "Mara Quinn" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(dialog.getByRole("link", { name: "Mara Quinn" })).toBeVisible();
    await dialog.getByRole("button", { name: "Move everything" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("definition").filter({ hasText: "Rose Hart" })).toBeVisible();

    await page.goto("/characters");
    await expect(page.getByRole("link", { name: /Mara Quinn.*Rose Hart/ })).toBeVisible();
  });

  test("tasks, the calendar and the dashboard keep the week on track", async ({ page }) => {
    test.slow();
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    const today = await localToday(page);

    // Write, and see it counted.
    await editorText(page).click();
    await page.keyboard.type("The lighthouse keeper counted the ships.");
    await expectSaved(page);

    // A deadline for the book.
    await page.goto(sceneUrl.split("/scenes/")[0]);
    await page.getByRole("button", { name: "Details" }).click();
    const details = page.getByRole("dialog", { name: "Book details" });
    await details.getByLabel("Target word count").fill("1000");
    await details.getByLabel("Draft deadline").fill(today);
    await details.getByRole("button", { name: "Save" }).click();
    await expect(details).toBeHidden();

    // A task for the book, from the book page.
    await page.getByRole("button", { name: "New task" }).click();
    const task = page.getByRole("dialog", { name: "New task" });
    await task.getByLabel("Task").fill("Fix the opening");
    await task.getByLabel("Due").fill(today);
    await task.getByRole("button", { name: "Add task" }).click();
    await expect(task).toBeHidden();
    await expect(page.getByRole("link", { name: "Fix the opening" })).toBeVisible();

    // Quick capture and check-off on the Tasks page.
    await page.goto("/tasks");
    await page.getByLabel("New task").fill("Email the cover designer");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const list = page.getByRole("list", { name: "Tasks" });
    await expect(list.getByRole("link", { name: "Email the cover designer" })).toBeVisible();
    await page.getByLabel("Mark Email the cover designer done").check();
    await expect(list.getByRole("link", { name: "Email the cover designer" })).toHaveCount(0);
    await page.getByRole("link", { name: "Done", exact: true }).click();
    await expect(page.getByRole("link", { name: "Email the cover designer" })).toBeVisible();

    // An event, with the task and the deadline, on the calendar.
    await page.goto("/calendar");
    await page.getByRole("button", { name: "New event" }).click();
    const event = page.getByRole("dialog", { name: "New event" });
    await event.getByLabel("Event").fill("Cover reveal");
    await event.getByRole("button", { name: "Add event" }).click();
    await expect(event).toBeHidden();
    const todayCell = page.locator('[aria-current="date"]');
    await expect(todayCell.getByRole("link", { name: /Cover reveal/ })).toBeVisible();
    await expect(todayCell.getByRole("link", { name: /Fix the opening/ })).toBeVisible();
    await expect(todayCell.getByRole("link", { name: /Harbour Lights due/ })).toBeVisible();
    await expect(todayCell).toContainText("6");

    // The dashboard: today's words, a goal, what's next and the book's pace.
    await page.goto("/dashboard");
    await expect(page.getByText("No daily goal set.")).toBeVisible();
    await page.getByRole("button", { name: "Set a daily goal" }).click();
    const goal = page.getByRole("dialog", { name: "Daily word goal" });
    await goal.getByLabel("Words per day").fill("100");
    await goal.getByRole("button", { name: "Save goal" }).click();
    await expect(goal).toBeHidden();
    await expect(page.getByText("94 to your goal of 100")).toBeVisible();
    await expect(page.getByRole("list", { name: "Coming up" })).toContainText("Cover reveal");
    await expect(page.getByRole("list", { name: "Book progress" })).toContainText("Harbour Lights");

    await page.getByRole("button", { name: "Log words" }).click();
    const log = page.getByRole("dialog", { name: "Log words" });
    await log.getByLabel("Words").fill("500");
    await log.getByRole("button", { name: "Log words" }).click();
    await expect(log).toBeHidden();
    await expect(page.getByText("Goal reached")).toBeVisible();
  });

  test("custom fields default to the character's pen name", async ({ page }) => {
    await createCharacter(page, "Mara Quinn");
    await page.getByRole("button", { name: "Add field" }).click();
    const form = page.getByRole("form", { name: "New field" });
    await expect(form.getByLabel("Applies to")).toHaveValue(/^pen:/);
    await expect(form.getByLabel("Applies to").getByRole("option")).toContainText([
      /This pen name/,
      "All pen names",
    ]);
    await form.getByLabel("Field name").fill("Magic type");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("textbox", { name: "Magic type" })).toBeVisible();
  });
});

test("planning pages fit a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await signUp(page);
  await createBookWithScene(page, "Small Screens");
  for (const path of ["/dashboard", "/tasks", "/calendar", "/structure/templates"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
