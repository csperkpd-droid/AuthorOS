import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene, createCharacter } from "./support/story-bible";

test.describe("Milestone 6", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop; phone layout is checked elsewhere.");

  test("a backup is reviewed, then imported into another account", async ({ page, browser }) => {
    test.slow(); // two accounts
    await signUp(page);
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Waves broke on the rocks.");
    await expectSaved(page);
    await page.goto("/export");
    await page.getByLabel("Standard backup (.json)").check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const backup = (await (await download).path())!;

    // Another author, in this same installation.
    const context = await browser.newContext();
    const other = await context.newPage();
    await signUp(other);
    await other.goto("/import");
    await expect(other.getByLabel("Plottr")).toBeDisabled();
    await other.getByLabel("Backup file").setInputFiles(backup);
    await other.getByRole("button", { name: "Review import" }).click();
    const review = other.getByRole("region", { name: "Import review" });
    // The ids belong to the first author's workspace: a conflict, no import.
    await expect(review).toContainText("Already in another workspace");
    await expect(review).toContainText("Scene: Scene 1");
    await expect(other.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);

    await other.getByLabel("Import as a copy (new ids)").check();
    await expect(review).toBeHidden();
    await other.getByRole("button", { name: "Review import" }).click();
    await expect(review).toContainText("This import will create");
    await expect(review.getByRole("row", { name: /Scenes/ })).toContainText("1");
    await other.getByRole("button", { name: "Import", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("Import complete");

    await other.getByRole("link", { name: "Go to the Library" }).click();
    await other
      .getByRole("link", { name: /Harbour Lights/ })
      .first()
      .click();
    await other.getByRole("link", { name: "Scene 1" }).click();
    await expect(editorText(other)).toHaveText("Waves broke on the rocks.");
    await context.close();
  });

  test("an invalid file is refused before anything changes", async ({ page }) => {
    await signUp(page);
    await page.goto("/import");
    await page.getByLabel("Backup file").setInputFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    await page.getByRole("button", { name: "Review import" }).click();
    const review = page.getByRole("region", { name: "Import review" });
    await expect(review).toContainText("can’t be imported");
    await expect(review).toContainText("isn’t an AuthorOS backup");
  });

  test("members have optional roles in a relationship", async ({ page }) => {
    await signUp(page);
    await createCharacter(page, "Kael");
    await createCharacter(page, "Elara");
    await page.getByRole("button", { name: "Add relationship" }).click();
    const dialog = page.getByRole("dialog", { name: "New relationship" });
    await dialog.getByLabel("Elara and…").selectOption({ label: "Kael" });
    await dialog.getByLabel("Type").fill("Romance");
    await dialog.getByRole("button", { name: "Create relationship" }).click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("region", { name: "Relationships" })
      .getByRole("link", { name: "Kael" })
      .click();

    await page.getByRole("button", { name: "Members" }).click();
    const members = page.getByRole("dialog", { name: "Members" });
    await members.getByLabel("Elara’s role").fill("Heroine");
    await members.getByLabel("Kael’s role").fill("MMC");
    await members.getByRole("button", { name: "Save members" }).click();
    await expect(members).toBeHidden();
    await expect(page.getByText("(Heroine)")).toBeVisible();
    await expect(page.getByText("(MMC)")).toBeVisible();
  });
});
