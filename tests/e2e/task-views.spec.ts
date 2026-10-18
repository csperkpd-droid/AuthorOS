import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene } from "./support/story-bible";

/**
 * Milestone 18: Task views. List, Board and Week over the same tasks; moves
 * change one field; Today on the Dashboard; "Make a task" from comments.
 */

const localToday = (page: Page) => page.evaluate(() => new Date().toLocaleDateString("en-CA"));
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const card = (page: Page, title: string) =>
  page.getByRole("group").getByRole("listitem").filter({ hasText: title });
const announcer = (page: Page) => page.locator("[id^=DndLiveRegion]");
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Task views" }).getByRole("link", { name });

/** Quick capture on the Tasks page; waits until the task shows (the form has reset). */
async function quickAdd(page: Page, title: string, dueOn = "") {
  await page.getByLabel("New task").fill(title);
  if (dueOn) await page.getByLabel("Due date").fill(dueOn);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("main").getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByLabel("New task")).toHaveValue("");
}

async function moveWithMenu(page: Page, title: string, to: string) {
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await card(page, title)
    .getByRole("button", { name: `Move ${title} to…` })
    .click();
  await page.getByRole("menuitem", { name: to, exact: true }).click();
  await saved;
}

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    "horizontal overflow",
  ).toBeLessThanOrEqual(0);

test.describe("Milestone 18: task views (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone flow is below.");

  test("Board and Week move the same tasks; Today shows what needs attention", async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page);
    const today = await localToday(page);
    await page.goto("/tasks");
    await expect(tab(page, "List")).toHaveAttribute("aria-current", "page");
    await quickAdd(page, "Draft the blurb", today);
    await quickAdd(page, "Email the editor");
    await quickAdd(page, "Return library books", addDays(today, -2));

    // Board: three columns; a move changes the status only.
    await tab(page, "Board").click();
    await expect(page).toHaveURL(/view=board/);
    await expect(column(page, "To do").getByRole("listitem")).toHaveCount(3);
    await moveWithMenu(page, "Email the editor", "In progress");
    await expect(column(page, "In progress")).toContainText("Email the editor");
    await page.reload();
    await expect(column(page, "In progress")).toContainText("Email the editor");

    // Keyboard: lift, arrow to the next column, drop.
    const handle = card(page, "Draft the blurb").getByRole("button", {
      name: "Drag Draft the blurb",
    });
    await expect(async () => {
      await handle.focus();
      await page.keyboard.press("Space");
      await expect(announcer(page).filter({ hasText: "Picked up Draft the blurb." })).toHaveCount(
        1,
        {
          timeout: 1000,
        },
      );
    }).toPass({ timeout: 10_000 });
    for (const lane of ["In progress", "Done"]) {
      await page.keyboard.press("ArrowRight");
      await expect(announcer(page)).toContainText(`Draft the blurb is over ${lane}.`);
    }
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await page.keyboard.press("Space");
    await saved;
    await expect(column(page, "Done")).toContainText("Draft the blurb");
    await page.reload();
    await expect(column(page, "Done")).toContainText("Draft the blurb");
    await expect(column(page, "To do")).toContainText("Return library books");

    // Mouse: drag a card's handle onto another column.
    const grip = card(page, "Return library books").getByRole("button", {
      name: "Drag Return library books",
    });
    const from = (await grip.boundingBox())!;
    const to = (await column(page, "In progress").boundingBox())!;
    const dropped = page.waitForResponse((r) => r.request().method() === "POST");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 15 });
    await page.mouse.up();
    await dropped;
    await expect(column(page, "In progress")).toContainText("Return library books");
    // Back to To do with the menu (the Week below expects it open and overdue).
    await moveWithMenu(page, "Return library books", "To do");
    await expect(column(page, "To do")).toContainText("Return library books");

    // Done links to every done task; the List shows the same task.
    await column(page, "Done").getByRole("link", { name: "All done tasks →" }).click();
    await expect(page).toHaveURL(/view=list&show=done/);
    await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Draft the blurb");

    // Week: a task's day is its due date; Overdue and No date trays.
    await page.goto("/tasks?view=week");
    await expect(column(page, "Overdue")).toContainText("Return library books");
    await expect(column(page, "No date")).toContainText("Email the editor");
    const todayLane = page.locator(`[data-lane="${today}"]`);
    await expect(todayLane).toContainText("Draft the blurb");
    const tomorrow = addDays(today, 1);
    const tomorrowLane = page.locator(`[data-lane="${tomorrow}"]`);
    if ((await tomorrowLane.count()) === 1) {
      const label = (await tomorrowLane.locator("h3 span").first().innerText()).trim();
      await moveWithMenu(page, "Email the editor", label);
      await expect(tomorrowLane).toContainText("Email the editor");
    }
    await moveWithMenu(page, "Draft the blurb", "No date");
    await expect(column(page, "No date")).toContainText("Draft the blurb");
    await expect(todayLane).not.toContainText("Draft the blurb");
    await page.goto("/tasks?view=list&show=done");
    await page.getByRole("link", { name: "Draft the blurb" }).click();
    await expect(page.getByText(/^Due /)).toHaveCount(0);

    // Plain /tasks opens the view last chosen on this device.
    await page.goto("/tasks?view=week");
    await page.goto("/tasks");
    await expect(page).toHaveURL(/view=week/);
    await tab(page, "List").click();
    await expect(tab(page, "List")).toHaveAttribute("aria-current", "page");
    await page.goto("/tasks");
    await expect(tab(page, "List")).toHaveAttribute("aria-current", "page");

    // Today on the Dashboard: overdue and in progress, but not what's done.
    await page.goto("/dashboard");
    const todayList = page.getByRole("list", { name: "Tasks for today" });
    await expect(todayList).toContainText("Return library books");
    await expect(todayList).toContainText("Email the editor");
    await expect(todayList).not.toContainText("Draft the blurb");
    await page.getByLabel("Mark Return library books done").check();
    await expect(todayList).not.toContainText("Return library books");
    await noOverflow(page);
  });

  test("Make a task from a comment, in the editor and in Review", async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page);
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Mara ran to the quay.");
    await expectSaved(page);
    await page.keyboard.press("Shift+Home");
    await page.getByRole("button", { name: "Comment on selected text" }).click();
    const panel = page.getByRole("complementary", { name: "Comments" });
    const form = panel.getByRole("form", { name: "New comment" });
    await form.getByLabel("Comment").fill("Too fast here?  Slow it down.");
    await form.getByRole("button", { name: "Add comment" }).click();
    await expect(form).toBeHidden();

    // From the panel: the title starts as the comment, and can be changed.
    await panel.getByRole("button", { name: "Make a task" }).click();
    let dialog = page.getByRole("dialog", { name: "Make a task" });
    await expect(dialog.getByLabel("Task")).toHaveValue("Too fast here? Slow it down.");
    await dialog.getByLabel("Task").fill("Slow down the quay scene");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog.getByRole("status")).toContainText("Task added.");
    await dialog.getByRole("button", { name: "Done" }).click();
    // The comment is unchanged, and the text too.
    await expect(panel.getByRole("listitem")).toHaveAttribute("data-state", "OPEN");
    await expect(panel).toContainText("Too fast here?  Slow it down.");
    await expect(editorText(page)).toHaveText("Mara ran to the quay.");

    // From Review.
    await page.goto("/review?view=open");
    await page.getByRole("main").getByRole("button", { name: "Make a task" }).click();
    dialog = page.getByRole("dialog", { name: "Make a task" });
    await dialog.getByRole("button", { name: "Add task" }).click();
    await dialog.getByRole("link", { name: "Open task" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Too fast here? Slow it down." }),
    ).toBeVisible();

    // Both tasks are about the scene; neither carries the quoted passage.
    await page.goto("/tasks?view=list");
    const list = page.getByRole("list", { name: "Tasks" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("Slow down the quay scene");
    await expect(list.getByRole("link", { name: "Scene 1" })).toHaveCount(2);
    await expect(list).not.toContainText("Mara ran to the quay.");
    await page.goto(sceneUrl);
    await expect(editorText(page)).toHaveText("Mara ran to the quay.");
  });
});

test("Milestone 18: task views on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(150_000);
  await signUp(page);
  const today = await localToday(page);
  await page.goto("/tasks");
  await quickAdd(page, "Draft the blurb", today);
  await quickAdd(page, "Email the editor");

  // Board: one column at a time, moves through the menu.
  await page.goto("/tasks?view=board");
  await expect(column(page, "To do")).toBeVisible();
  await expect(column(page, "In progress")).toBeHidden();
  await expect(card(page, "Draft the blurb").getByRole("button", { name: /^Drag/ })).toBeHidden();
  await moveWithMenu(page, "Email the editor", "In progress");
  await page.getByRole("tab", { name: /In progress/ }).click();
  await expect(column(page, "In progress")).toContainText("Email the editor");
  await noOverflow(page);

  // Week: a list of days, moves through the menu.
  await page.goto("/tasks?view=week");
  await expect(page.locator(`[data-lane="${today}"]`)).toContainText("Draft the blurb");
  await moveWithMenu(page, "Draft the blurb", "No date");
  await expect(column(page, "No date")).toContainText("Draft the blurb");
  await noOverflow(page);

  await page.goto("/dashboard");
  await expect(page.getByRole("list", { name: "Tasks for today" })).toContainText(
    "Email the editor",
  );
  await noOverflow(page);
});
