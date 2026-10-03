import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { switchIdentity } from "./support/manuscript";
import { createBookWithScene, createCharacter, expectSaved } from "./support/story-bible";

const post = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");

async function createRelationship(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: "Add relationship" }).click();
  const dialog = page.getByRole("dialog", { name: "New relationship" });
  await dialog.getByLabel(`${from} and…`).selectOption({ label: to });
  await dialog.getByLabel("Type").fill("Romance");
  await dialog.getByRole("button", { name: "Create relationship" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("region", { name: "Relationships" }).getByRole("link", { name: to }).click();
  await expect(page).toHaveURL(/\/relationships\//);
}

async function placeBeat(page: Page, beat: string, scene: RegExp) {
  const saved = post(page);
  await page.getByLabel(`Place ${beat} in a scene`).selectOption({ label: "Chapter 1 › Scene 1" });
  await saved;
  await expect(
    page.getByRole("list", { name: `Scenes for ${beat}` }).getByRole("link", { name: scene }),
  ).toBeVisible();
}

test.describe("story structure", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop; mobile layout is checked below.");

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("plot and romance structures share one scene, never copying it", async ({ page }) => {
    test.slow();
    await createCharacter(page, "Theo Vance");
    await createCharacter(page, "Mara Quinn");
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    const bookUrl = sceneUrl.split("/scenes/")[0];

    // A plot beat sheet from the book page.
    await page.goto(bookUrl);
    await page.getByRole("button", { name: "New structure" }).click();
    let dialog = page.getByRole("dialog", { name: "New structure" });
    await dialog.getByLabel("Template").selectOption("00000000-0000-7000-8000-000000000a02");
    await dialog.getByRole("button", { name: "Create structure" }).click();
    await expect(page.getByLabel("Structure name")).toHaveValue("Save the Cat");
    await expect(page.getByRole("article", { name: "Opening Image" })).toBeVisible();
    await placeBeat(page, "Opening Image", /Scene 1/);
    await expect(page.getByText("1 of 15 beats placed")).toBeVisible();

    // A romance arc from the relationship page, using the same scene.
    await page.goto("/characters");
    await page.getByRole("link", { name: /Theo Vance/ }).click();
    await createRelationship(page, "Theo Vance", "Mara Quinn");
    await page.getByRole("button", { name: "New romance arc" }).click();
    dialog = page.getByRole("dialog", { name: "New structure" });
    await expect(dialog.getByLabel("Kind")).toHaveValue("ROMANCE");
    await dialog.getByRole("button", { name: "Create structure" }).click();
    await expect(page.getByLabel("Structure name")).toHaveValue(/Romancing the Beat/);
    await placeBeat(page, "Meet", /Scene 1/);

    // Your own beat, edited and reordered like any other.
    await page.getByRole("button", { name: "Add beat" }).click();
    dialog = page.getByRole("dialog", { name: "New beat" });
    await dialog.getByLabel("Beat").fill("Storm strands them");
    await dialog.getByLabel("Target position (% of the book)").fill("30");
    await dialog.getByRole("button", { name: "Add beat" }).click();
    const custom = page.getByRole("article", { name: "Storm strands them" });
    await expect(custom.getByText("~30%")).toBeVisible();
    await page.getByRole("button", { name: "Actions for Storm strands them" }).click();
    await page.getByRole("menuitem", { name: "Remove beat" }).click();
    const review = page.getByRole("dialog", { name: "Remove the beat “Storm strands them”?" });
    await review.getByRole("button", { name: "Remove beat" }).click();
    await expect(custom).toHaveCount(0);

    // The scene shows both beats, and is still one scene.
    await page.goto(sceneUrl);
    const beats = page.getByRole("list", { name: "Story beats in this scene" });
    await expect(beats.getByRole("link", { name: /Plot:.*Opening Image/ })).toBeVisible();
    await expect(beats.getByRole("link", { name: /Romance arc:.*Meet/ })).toBeVisible();
    await page.goto(bookUrl);
    await expect(page.getByRole("link", { name: "Scene 1" })).toHaveCount(1);
    const structures = page.getByRole("list", { name: "Structures" });
    await expect(structures.getByRole("link")).toHaveCount(2);

    // Removing a beat from the scene leaves the scene alone.
    await structures.getByRole("link", { name: /Save the Cat/ }).click();
    await page.getByRole("button", { name: "Remove Scene 1 from Opening Image" }).click();
    await expect(
      page.getByRole("article", { name: "Opening Image" }).getByText("Not placed"),
    ).toBeVisible();

    // Structures go to the Trash like other story objects.
    await page.getByRole("button", { name: "Move structure to Trash" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/structure$/);
    await expect(page.getByRole("link", { name: /Save the Cat/ })).toHaveCount(0);
    await page.goto("/trash");
    await expect(page.getByText("Save the Cat")).toBeVisible();
  });

  test("notes keep a version history", async ({ page }) => {
    await page.goto("/notes");
    await page.getByRole("button", { name: "New note" }).click();
    const create = page.getByRole("dialog", { name: "New note" });
    await create.getByLabel("Title").fill("Harbour research");
    await create.getByRole("button", { name: "Create note" }).click();
    const text = page.getByRole("textbox", { name: "Note text" });
    await text.click();
    await page.keyboard.type("Tides turn twice a day.");
    await expectSaved(page);

    await page.getByRole("button", { name: "History" }).click();
    let dialog = page.getByRole("dialog", { name: "Note history" });
    await dialog.getByLabel("Version name").fill("Facts");
    await dialog.getByRole("button", { name: "Save version" }).click();
    await expect(dialog.getByText("Facts")).toBeVisible();
    await page.keyboard.press("Escape");

    await text.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Wrong.");
    await expectSaved(page);

    await page.getByRole("button", { name: "History" }).click();
    dialog = page.getByRole("dialog", { name: "Note history" });
    await dialog
      .getByRole("listitem")
      .filter({ hasText: "Facts" })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(text).toHaveText("Tides turn twice a day.");
  });

  test("characters stay with their pen name", async ({ page }) => {
    await page.goto("/identities");
    await page.getByRole("button", { name: "New pen name" }).click();
    const dialog = page.getByRole("dialog", { name: "New pen name" });
    await dialog.getByLabel("Name").fill("Rose Hart");
    await dialog.getByRole("button", { name: "Create pen name" }).click();
    await expect(dialog).toBeHidden();

    await switchIdentity(page, "Rose Hart");
    await createCharacter(page, "Daisy Bloom");
    await expect(page.getByRole("main").getByText("Rose Hart", { exact: true })).toBeVisible();

    // Writing as the other identity, Daisy is not there.
    const other = await page.getByLabel("Writing as").locator("option").nth(1).textContent();
    await switchIdentity(page, other!.trim());
    await page.goto("/characters");
    await expect(page.getByRole("link", { name: /Daisy Bloom/ })).toHaveCount(0);

    await switchIdentity(page, "All identities");
    await page.goto("/characters");
    await expect(page.getByRole("link", { name: /Daisy Bloom.*Rose Hart/ })).toBeVisible();
  });

  test("characters get the author's own fields", async ({ page }) => {
    const url = await createCharacter(page, "Mara Quinn");
    await page.getByRole("button", { name: "Add field" }).click();
    const form = page.getByRole("form", { name: "New field" });
    await form.getByLabel("Field name").fill("Love language");
    await form.getByRole("button", { name: "Add" }).click();
    await page.getByRole("textbox", { name: "Love language" }).fill("Acts of service");
    await page.getByLabel("Goal").click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await page.goto(url);
    await expect(page.getByRole("textbox", { name: "Love language" })).toHaveValue(
      "Acts of service",
    );
  });
});

test("structure pages fit a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await signUp(page);
  const sceneUrl = await createBookWithScene(page, "Small Screens");
  await page.goto(sceneUrl.split("/scenes/")[0]);
  await page.getByRole("button", { name: "New structure" }).click();
  await page
    .getByRole("dialog", { name: "New structure" })
    .getByRole("button", { name: "Create structure" })
    .click();
  await expect(page.getByLabel("Structure name")).toBeVisible();
  for (const path of [page.url(), "/structure"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
