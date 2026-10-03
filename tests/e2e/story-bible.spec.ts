import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import {
  connectTo,
  createBookWithScene,
  createCharacter,
  expectSaved,
} from "./support/story-bible";

test.describe("story bible and universal connections", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "Exercised on desktop; mobile layout is checked separately.",
  );

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("casts characters into a scene, creating one inline and handing over POV", async ({
    page,
  }) => {
    const maraUrl = await createCharacter(page, "Mara Quinn", "Protagonist");
    await page.getByLabel("Goal").fill("Keep the light burning");
    await page.getByLabel("Occupation").click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    const sceneUrl = await createBookWithScene(page, "The Long Night");
    const cast = page.getByRole("region", { name: "Characters in this scene" });

    // First character defaults to point of view.
    await cast.getByRole("button", { name: "Add character" }).click();
    let dialog = page.getByRole("dialog", { name: "Add a character to this scene" });
    await dialog.getByLabel("Character name").fill("Mara");
    await dialog
      .getByRole("list", { name: "Characters" })
      .getByRole("button", { name: "Mara Quinn" })
      .click();
    await expect(cast.getByLabel("Role of Mara Quinn")).toHaveValue("POV");

    // Create a brand-new character straight from the scene.
    await cast.getByRole("button", { name: "Add character" }).click();
    dialog = page.getByRole("dialog", { name: "Add a character to this scene" });
    await dialog.getByLabel("Character name").fill("Harbourmaster Bell");
    await dialog.getByRole("button", { name: "Create “Harbourmaster Bell”" }).click();
    await expect(cast.getByLabel("Role of Harbourmaster Bell")).toHaveValue("PRESENT");

    // A scene has one POV: giving it to Bell hands it over.
    await cast.getByLabel("Role of Harbourmaster Bell").selectOption("POV");
    await expect(cast.getByLabel("Role of Mara Quinn")).toHaveValue("PRESENT");
    await expect(cast.getByLabel("Role of Harbourmaster Bell")).toHaveValue("POV");

    // The character page shows the appearance (and survives a reload).
    await page.goto(maraUrl);
    await expect(page.getByLabel("Goal")).toHaveValue("Keep the light burning");
    const appears = page.getByRole("list", { name: "Appears in" });
    await expect(appears.getByRole("link", { name: /Scene 1/ })).toBeVisible();
    await expect(appears.getByLabel("Role of Scene 1")).toHaveValue("PRESENT");

    // Remove from the scene.
    await page.goto(sceneUrl);
    await cast.getByRole("button", { name: "Remove Mara Quinn from this scene" }).click();
    await expect(cast.getByLabel("Role of Mara Quinn")).toHaveCount(0);
  });

  test("notes connect to scenes, characters and anything else", async ({ page }) => {
    await createCharacter(page, "Mara Quinn");
    const sceneUrl = await createBookWithScene(page, "The Long Night");

    // A note created from the scene is already about it.
    await page.getByRole("button", { name: "New note" }).click();
    await page
      .getByRole("dialog", { name: "New note" })
      .getByLabel("Title")
      .fill("Lighthouse research");
    await page
      .getByRole("dialog", { name: "New note" })
      .getByRole("button", { name: "Create note" })
      .click();
    await expect(page).toHaveURL(/\/notes\//);
    const noteUrl = page.url();
    const about = page.getByRole("region", { name: "About" });
    await expect(about.getByRole("link", { name: /Scene 1/ })).toBeVisible();

    await page.getByRole("textbox", { name: "Note text" }).click();
    await page.keyboard.type("Fresnel lenses were introduced in 1823.");
    await expectSaved(page);

    // Connect the same note to a character.
    await connectTo(page, { search: "Mara", pick: /Mara Quinn/ });
    await expect(about.getByRole("link", { name: /Mara Quinn/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText(
      "Fresnel lenses were introduced in 1823.",
    );

    // The scene lists the note; the character does too.
    await page.goto(sceneUrl);
    await expect(
      page.getByRole("list", { name: "Notes" }).getByRole("link", { name: /Lighthouse research/ }),
    ).toBeVisible();
    await page.goto("/characters");
    await page.getByRole("link", { name: /Mara Quinn/ }).click();
    await expect(
      page.getByRole("list", { name: "Notes" }).getByRole("link", { name: /Lighthouse research/ }),
    ).toBeVisible();

    // Removing a connection leaves both objects in place.
    await page.goto(noteUrl);
    await about.getByRole("button", { name: "Remove connection to Mara Quinn" }).click();
    await expect(about.getByRole("link", { name: /Mara Quinn/ })).toHaveCount(0);
    await expect(about.getByRole("link", { name: /Scene 1/ })).toBeVisible();
  });

  test("relationships are story objects with their own scenes and notes", async ({ page }) => {
    await createCharacter(page, "Mara Quinn");
    const sceneUrl = await createBookWithScene(page, "The Long Night");
    const theoUrl = await createCharacter(page, "Theo Vance");

    await page.getByRole("button", { name: "Add relationship" }).click();
    const dialog = page.getByRole("dialog", { name: "New relationship" });
    await dialog.getByLabel("Theo Vance and…").selectOption({ label: "Mara Quinn" });
    await dialog.getByLabel("Type").fill("Romance");
    await dialog.getByLabel("Description").fill("Exes. A second chance.");
    await dialog.getByRole("button", { name: "Create relationship" }).click();

    const rels = page.getByRole("region", { name: "Relationships" });
    await rels.getByRole("link", { name: "Mara Quinn" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Mara Quinn & Theo Vance|Theo Vance & Mara Quinn/,
    );

    // The scene where the relationship develops.
    await connectTo(page, { kind: "Develops in", search: "Scene", pick: /Scene 1/ });
    await expect(
      page.getByRole("list", { name: "Develops in" }).getByRole("link", { name: /Scene 1/ }),
    ).toBeVisible();

    await page.goto(sceneUrl);
    await expect(
      page.getByRole("list", { name: "Relationship moments" }).getByRole("link", { name: /&/ }),
    ).toBeVisible();

    // A duplicate pair is refused.
    await page.goto(theoUrl);
    await page.getByRole("button", { name: "Add relationship" }).click();
    const again = page.getByRole("dialog", { name: "New relationship" });
    await again.getByLabel("Theo Vance and…").selectOption({ label: "Mara Quinn" });
    await again.getByLabel("Type").fill("Rivals");
    await again.getByRole("button", { name: "Create relationship" }).click();
    await expect(again.getByRole("alert")).toContainText("already have a relationship");
  });

  test("ideas are captured and turned into books, linked back", async ({ page }) => {
    await page.goto("/ideas");
    await page.getByLabel("New idea").fill("A lighthouse keeper who can't swim");
    await page.getByLabel("Idea details").fill("Set on a storm-wrecked coast.");
    await page.getByRole("button", { name: "Save idea" }).click();
    await page
      .getByRole("list", { name: "Ideas" })
      .getByRole("link", { name: /lighthouse keeper/ })
      .click();

    await page.getByRole("button", { name: "Turn into a book" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "A lighthouse keeper who can't swim" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Inspired by" })
        .getByRole("link", { name: /lighthouse keeper/ }),
    ).toBeVisible();

    await page.goto("/ideas");
    await expect(page.getByRole("list", { name: "Ideas" })).toContainText("Used");
  });

  test("trashing a character hides its links; restoring brings them back", async ({ page }) => {
    const maraUrl = await createCharacter(page, "Mara Quinn");
    const sceneUrl = await createBookWithScene(page, "Trash Test");
    const cast = page.getByRole("region", { name: "Characters in this scene" });
    await cast.getByRole("button", { name: "Add character" }).click();
    await page.getByRole("dialog").getByLabel("Character name").fill("Mara");
    await page
      .getByRole("dialog")
      .getByRole("list", { name: "Characters" })
      .getByRole("button", { name: "Mara Quinn" })
      .click();
    await expect(cast.getByLabel("Role of Mara Quinn")).toBeVisible();

    await page.goto(maraUrl);
    await page.getByRole("button", { name: "Move character to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/characters$/);

    await page.goto(sceneUrl);
    await expect(cast.getByLabel("Role of Mara Quinn")).toHaveCount(0);

    await page.goto("/trash");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Mara Quinn" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.goto(sceneUrl);
    await expect(cast.getByLabel("Role of Mara Quinn")).toHaveValue("POV");
  });
});

test("story bible pages fit a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only check");
  await signUp(page);
  const characterUrl = await createCharacter(page, "Mara Quinn");
  const sceneUrl = await createBookWithScene(page, "Pocket");
  await expect(page.getByRole("region", { name: "Characters in this scene" })).toBeVisible();

  for (const path of [
    "/characters",
    characterUrl,
    "/relationships",
    "/notes",
    "/ideas",
    sceneUrl,
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
