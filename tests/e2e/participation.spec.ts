import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import {
  addToScene,
  castMember,
  changePart,
  createBookWithScene,
  createCharacter,
  expectPart,
  sceneCast,
} from "./support/story-bible";

/** Milestone 11: Scene Participation (Point of view, Present, Mentioned). */

const pov = (page: Page) => page.getByTestId("scene-pov");

async function writeLine(page: Page, text: string) {
  await editorText(page).click();
  await page.keyboard.type(text);
  await expectSaved(page);
}

test.describe("Milestone 11: Scene Participation (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "The phone workflow is below.");

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000);
    await signUp(page);
  });

  test("present, mentioned, one point of view changed explicitly; the text never changes", async ({
    page,
  }) => {
    const charlieUrl = await createCharacter(page, "Charlie Vane");
    await createCharacter(page, "Harbourmaster Bell");
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await writeLine(page, "The lamps went out one by one.");
    await expect(pov(page)).toHaveText("No point of view chosen");

    // Charlie: point of view and present (offered for the first character).
    await addToScene(page, "Charlie Vane", { search: "Charlie" });
    await expectPart(page, "Charlie Vane", "Point of view, present");
    await expect(pov(page)).toHaveText("Point of view:Charlie Vane");

    // Bell is only mentioned; the point of view isn't on offer while Charlie has it.
    await sceneCast(page).getByRole("button", { name: "Add character" }).click();
    const add = page.getByRole("dialog", { name: "Add a character to this scene" });
    await expect(add.getByLabel("Point of view")).toBeDisabled();
    await expect(add).toContainText("told from Charlie Vane’s point of view");
    await add.getByRole("button", { name: "Close" }).click();
    await addToScene(page, "Harbourmaster Bell", { search: "Bell", presence: "Mentioned" });
    await expectPart(page, "Harbourmaster Bell", "Mentioned");

    // A new character, created from the scene, present.
    await addToScene(page, "Dana Reyes", { create: true });
    await expectPart(page, "Dana Reyes", "Present");

    // Making Bell the point of view asks first; cancelling changes nothing.
    await changePart(page, "Harbourmaster Bell", "Make point of view");
    let confirm = page.getByRole("dialog", { name: /Change the point of view to/ });
    await expect(confirm).toContainText("told from Charlie Vane’s point of view now");
    await expect(confirm).toContainText("The scene’s text isn’t changed.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expectPart(page, "Charlie Vane", "Point of view, present");
    await expectPart(page, "Harbourmaster Bell", "Mentioned");

    // Giving it to Dana: Charlie stays, as present.
    await changePart(page, "Dana Reyes", "Make point of view");
    confirm = page.getByRole("dialog", { name: "Change the point of view to Dana Reyes?" });
    await confirm.getByRole("button", { name: "Change point of view" }).click();
    await expect(confirm).toBeHidden();
    await expectPart(page, "Dana Reyes", "Point of view, present");
    await expectPart(page, "Charlie Vane", "Present");
    await expect(pov(page)).toHaveText("Point of view:Dana Reyes");

    // Present ↔ mentioned, and taking the point of view away.
    await changePart(page, "Harbourmaster Bell", /^Present/);
    await expectPart(page, "Harbourmaster Bell", "Present");
    await changePart(page, "Harbourmaster Bell", /^Mentioned/);
    await expectPart(page, "Harbourmaster Bell", "Mentioned");
    await changePart(page, "Dana Reyes", "Remove point of view");
    await expect(pov(page)).toHaveText("No point of view chosen");
    await expectPart(page, "Dana Reyes", "Present");

    // Removing someone from the scene.
    await changePart(page, "Dana Reyes", "Remove from this scene");
    await expect(castMember(page, "Dana Reyes")).toHaveCount(0);

    // Every change is in the scene's history.
    await sceneCast(page).getByRole("button", { name: "Changes" }).click();
    const history = page.getByRole("list", { name: "Changes to the characters in this scene" });
    await expect(history).toContainText("Dana Reyes · Removed");
    await expect(history).toContainText("Dana Reyes · No longer the point of view");
    await expect(history).toContainText("Dana Reyes · Became the point of view");
    await expect(history).toContainText("Charlie Vane · No longer the point of view");
    await expect(history).toContainText("Harbourmaster Bell · Added: Mentioned");
    await expect(history).toContainText("Charlie Vane · Added: Point of view, present");
    await page.keyboard.press("Escape");

    // The manuscript text is exactly as written.
    await page.reload();
    await expect(editorText(page)).toHaveText("The lamps went out one by one.");
    await expectPart(page, "Charlie Vane", "Present");

    // From the character: their scenes, by part, through search.
    await page.goto(charlieUrl);
    const scenes = page.getByRole("list", { name: "Scenes with Charlie Vane" });
    await expect(scenes.getByRole("link", { name: "Scene 1" })).toBeVisible();
    await expect(scenes).toContainText("Present");
    const filters = page.getByRole("navigation", { name: "Find scenes by part" });
    await expect(filters.getByRole("link", { name: "Point of view (0)" })).toBeVisible();
    await filters.getByRole("link", { name: "Present (1)" }).click();
    await expect(page).toHaveURL(/\/search\?.*role=present/);
    await expect(page.getByRole("list", { name: "Results" })).toContainText("Scene 1");
    await page
      .getByRole("navigation", { name: "Charlie Vane’s part in the scene" })
      .getByRole("link", { name: "Point of view" })
      .click();
    await expect(page.getByText("No scenes found.")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Charlie Vane’s part in the scene" })
      .getByRole("link", { name: "All scenes" })
      .click();
    await page
      .getByRole("list", { name: "Results" })
      .getByRole("link", { name: /Scene 1/ })
      .click();
    await expect(page).toHaveURL(sceneUrl);
  });
});

test("Milestone 11: the scene's characters on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  test.setTimeout(90_000);
  await signUp(page);
  await createCharacter(page, "Charlie Vane");
  await createBookWithScene(page, "Pocket");

  await addToScene(page, "Charlie Vane", { search: "Charlie" });
  await addToScene(page, "Dana Reyes", { create: true, presence: "Mentioned" });
  await expect(pov(page)).toHaveText("Point of view:Charlie Vane");
  await expectPart(page, "Dana Reyes", "Mentioned");

  // The same explicit change of point of view, by touch.
  await changePart(page, "Dana Reyes", "Make point of view");
  await page
    .getByRole("dialog", { name: "Change the point of view to Dana Reyes?" })
    .getByRole("button", { name: "Change point of view" })
    .click();
  await expectPart(page, "Dana Reyes", "Point of view, mentioned");
  await expectPart(page, "Charlie Vane", "Present");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
