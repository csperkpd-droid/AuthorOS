import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene, createCharacter } from "./support/story-bible";

test.describe("Milestone 5", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop; phone layout is checked below.");

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("group relationships: a Why Choose group with the pairs inside it", async ({ page }) => {
    for (const name of ["Kael", "Rowan"]) await createCharacter(page, name);
    await createCharacter(page, "Elara");
    await page.getByRole("button", { name: "Add relationship" }).click();
    const dialog = page.getByRole("dialog", { name: "New relationship" });
    await dialog.getByLabel("Elara and…").selectOption({ label: "Kael" });
    await dialog.getByRole("button", { name: "Add another character" }).click();
    await dialog.getByLabel("And (3)").selectOption({ label: "Rowan" });
    await dialog.getByLabel("Type").fill("Romance");
    await dialog.getByRole("button", { name: "Create relationship" }).click();
    await expect(dialog).toBeHidden();

    await page
      .getByRole("region", { name: "Relationships" })
      .getByRole("link", { name: "Kael & Rowan" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elara, Kael & Rowan");
    await expect(page.getByText("Group of 3")).toBeVisible();

    // Each pair can be its own relationship.
    const within = page.getByRole("list", { name: "Within the group" });
    await within.getByRole("button", { name: "Add the relationship between Elara & Kael" }).click();
    await expect(within.getByRole("link", { name: "Elara & Kael" })).toBeVisible();
    await within.getByRole("link", { name: "Elara & Kael" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elara & Kael");
    await expect(page.getByText("Part of")).toContainText("Elara, Kael & Rowan");
  });

  test("template kits apply several structures, asking whose romance arc", async ({ page }) => {
    test.slow();
    await createCharacter(page, "Mara");
    await createCharacter(page, "Theo");
    await page.getByRole("button", { name: "Add relationship" }).click();
    const rel = page.getByRole("dialog", { name: "New relationship" });
    await rel.getByLabel("Theo and…").selectOption({ label: "Mara" });
    await rel.getByLabel("Type").fill("Romance");
    await rel.getByRole("button", { name: "Create relationship" }).click();
    await expect(rel).toBeHidden();

    await page.goto("/structure/templates");
    await page.getByRole("button", { name: "New kit" }).click();
    const kit = page.getByRole("dialog", { name: "New template kit" });
    await kit.getByLabel("Kit name").fill("My Romantasy Book Kit");
    await kit.getByRole("checkbox", { name: /Save the Cat/ }).check();
    await kit.getByRole("checkbox", { name: /Romancing the Beat/ }).check();
    await kit.getByRole("button", { name: "Create kit" }).click();
    await expect(kit).toBeHidden();
    await expect(page.getByRole("list", { name: "Template kits" })).toContainText(
      "My Romantasy Book Kit",
    );

    const sceneUrl = await createBookWithScene(page, "Ember");
    await page.goto(sceneUrl.split("/scenes/")[0]);
    await page.getByRole("button", { name: "Apply kit" }).click();
    const apply = page.getByRole("dialog", { name: "Apply a template kit" });
    await apply.getByRole("checkbox", { name: /Theo & Mara|Mara & Theo/ }).check();
    await apply.getByRole("button", { name: "Apply kit" }).click();
    await expect(apply.getByRole("status")).toContainText("Created 2 structures");
    await apply.getByRole("button", { name: "Done" }).click();
    const structures = page.getByRole("list", { name: "Structures" });
    await expect(structures.getByRole("link")).toHaveCount(2);
    await expect(structures).toContainText("Romancing the Beat");
  });

  test("deleting an in-use field shows what will be lost", async ({ page }) => {
    await createCharacter(page, "Mara");
    await page.getByRole("button", { name: "Add field" }).click();
    const form = page.getByRole("form", { name: "New field" });
    await form.getByLabel("Field name").fill("Love language");
    await form.getByRole("button", { name: "Add" }).click();
    await page.getByRole("textbox", { name: "Love language" }).fill("Acts of service");
    await page.getByLabel("Goal").click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await page.getByRole("button", { name: "Remove the Love language field" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete the “Love language” field?" });
    await expect(dialog.getByRole("status")).toHaveText("This will affect 1 item: 1 value.");
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(dialog).toContainText("“Acts of service”");
    await dialog.getByRole("button", { name: "Delete field" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Love language" })).toHaveCount(0);
  });

  test("search finds words in scenes and opens them", async ({ page }) => {
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("The lighthouse keeper counted the ships.");
    await expectSaved(page);

    await page.goto("/search");
    await page.getByLabel("Search").first().fill("lighth");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const results = page.getByRole("list", { name: "Results" });
    await expect(results.getByRole("link", { name: /Scene 1/ })).toBeVisible();
    await expect(results.locator("mark")).toHaveText("lighthouse");
    await results.getByRole("link", { name: /Scene 1/ }).click();
    await expect(page).toHaveURL(/\/scenes\//);
  });

  test("exports a Word manuscript, Markdown and a structured backup", async ({ page }) => {
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Waves broke on the rocks.");
    await expectSaved(page);

    await page.goto("/export");
    // Writing as all identities: the whole workspace is the default.
    await expect(page.getByLabel(/Current pen name/)).toBeDisabled();
    await expect(page.getByLabel("Entire workspace")).toBeChecked();

    const word = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    expect((await word).suggestedFilename()).toBe("harbour-lights.docx");

    await page.getByLabel("Markdown manuscript (.md)").check();
    const md = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const mdFile = await md;
    expect(mdFile.suggestedFilename()).toBe("harbour-lights.md");
    const text = await readFile((await mdFile.path())!, "utf8");
    expect(text).toContain("# Harbour Lights");
    expect(text).toContain("Waves broke on the rocks.");

    await page.getByLabel("Entire workspace").check();
    await page.getByLabel("Standard backup (.json)").check();
    const json = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const backup = JSON.parse(await readFile((await (await json).path())!, "utf8"));
    expect(backup).toMatchObject({ format: "authoros.workspace", version: 8 });
    expect(backup.scenes[0].contentText).toBe("Waves broke on the rocks.");
  });
});

test("search and export fit a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await signUp(page);
  for (const path of ["/search?q=storm", "/export", "/import", "/structure/templates"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
