import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import {
  addToScene,
  castMember,
  changePart,
  connectTo,
  createBookWithScene,
  createCharacter,
  expectPart,
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

  test("casts characters into a scene, creating one inline and changing the POV explicitly", async ({
    page,
  }) => {
    const maraUrl = await createCharacter(page, "Mara Quinn", "Protagonist");
    await page.getByLabel("Goal").fill("Keep the light burning");
    await page.getByLabel("Occupation").click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    const sceneUrl = await createBookWithScene(page, "The Long Night");
    await expect(page.getByTestId("scene-pov")).toHaveText("No point of view chosen");

    // The first character is offered as the point of view.
    await addToScene(page, "Mara Quinn", { search: "Mara" });
    await expectPart(page, "Mara Quinn", "Point of view, present");
    await expect(page.getByTestId("scene-pov")).toHaveText("Point of view:Mara Quinn");

    // Create a brand-new character straight from the scene.
    await addToScene(page, "Harbourmaster Bell", { create: true });
    await expectPart(page, "Harbourmaster Bell", "Present");

    // A scene has one POV: giving it to Bell is an explicit, confirmed change.
    await changePart(page, "Harbourmaster Bell", "Make point of view");
    const confirm = page.getByRole("dialog", {
      name: "Change the point of view to Harbourmaster Bell?",
    });
    await expect(confirm).toContainText("Mara Quinn stays in the scene as present");
    await confirm.getByRole("button", { name: "Change point of view" }).click();
    await expect(confirm).toBeHidden();
    await expectPart(page, "Mara Quinn", "Present");
    await expectPart(page, "Harbourmaster Bell", "Point of view, present");

    // The character page lists the scene, with Mara's part in it (after a reload too).
    await page.goto(maraUrl);
    await expect(page.getByLabel("Goal")).toHaveValue("Keep the light burning");
    const scenes = page.getByRole("list", { name: "Scenes with Mara Quinn" });
    await expect(scenes.getByRole("link", { name: "Scene 1" })).toBeVisible();
    await expect(scenes).toContainText("Present");

    // Remove from the scene.
    await page.goto(sceneUrl);
    await changePart(page, "Mara Quinn", "Remove from this scene");
    await expect(castMember(page, "Mara Quinn")).toHaveCount(0);
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
    await addToScene(page, "Mara Quinn", { search: "Mara" });

    await page.goto(maraUrl);
    await page.getByRole("button", { name: "Move character to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/characters$/);

    await page.goto(sceneUrl);
    await expect(castMember(page, "Mara Quinn")).toHaveCount(0);

    await page.goto("/trash");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Mara Quinn" })
      .getByRole("button", { name: "Restore" })
      .click();
    // Wait for the restore to finish before leaving the Trash.
    await expect(page.getByRole("listitem").filter({ hasText: "Mara Quinn" })).toHaveCount(0);
    await page.goto(sceneUrl);
    await expectPart(page, "Mara Quinn", "Point of view, present");
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
