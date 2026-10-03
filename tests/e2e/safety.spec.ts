import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene, createCharacter } from "./support/story-bible";

test.describe("Milestone 8: safety", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop.");

  test.beforeEach(async ({ page }) => {
    await signUp(page);
  });

  test("writing continues offline: saved on this device, then synced", async ({
    page,
    context,
  }) => {
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("The tide came in.");
    await expectSaved(page);
    const status = page.getByTestId("save-status");
    await expect(status).toContainText("Saved to the cloud");

    await context.setOffline(true);
    await page.keyboard.type(" The lamps went out.");
    // Never claims the cloud has it.
    await expect(status).toHaveText("Saved on this device · offline, will sync");
    await expect(status).toHaveAttribute("data-device", "saved");

    await context.setOffline(false);
    await expectSaved(page);
    await page.reload();
    await expect(editorText(page)).toHaveText("The tide came in. The lamps went out.");
  });

  test("text that never reached the cloud is restored after a crash", async ({ page, context }) => {
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Saved line.");
    await expectSaved(page);

    // The cloud stops answering (Server Action posts fail).
    await page.route("**/*", (route) =>
      route.request().method() === "POST" && route.request().headers()["next-action"]
        ? route.abort()
        : route.continue(),
    );
    await page.keyboard.type(" Unsynced line.");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved on this device/);
    // The tab dies without a chance to save.
    await page.close({ runBeforeUnload: false });

    const again = await context.newPage();
    await again.goto(sceneUrl);
    await expect(again.getByTestId("draft-recovery")).toContainText(
      "Restored text from this device",
    );
    await expect(editorText(again)).toHaveText("Saved line. Unsynced line.");
    await expectSaved(again);
  });

  test("earlier text of a field can be restored", async ({ page }) => {
    await createCharacter(page, "Elara");
    for (const summary of ["A smuggler.", "A queen in hiding."]) {
      await page.getByRole("button", { name: "Details" }).click();
      const dialog = page.getByRole("dialog", { name: "Character details" });
      await dialog.getByLabel("Summary").fill(summary);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(summary)).toBeVisible();
    }
    await page.getByRole("button", { name: "Earlier versions" }).click();
    const history = page.getByRole("dialog", { name: "Earlier versions" });
    await expect(history.getByRole("list", { name: "Earlier values" })).toContainText(
      "A smuggler.",
    );
    await history.getByRole("button", { name: "Restore this summary" }).first().click();
    await expect(history).toBeHidden();
    await expect(page.getByText("A smuggler.")).toBeVisible();
  });

  test("a suggested consequence happens only when the author accepts it", async ({ page }) => {
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await page.goto(sceneUrl.split("/scenes/")[0]);
    await page.getByRole("button", { name: "New structure" }).click();
    const create = page.getByRole("dialog", { name: "New structure" });
    await create.getByLabel("Template").selectOption("");
    await create.getByLabel("Name").fill("Plot");
    await create.getByRole("button", { name: "Create structure" }).click();
    await expect(page.getByLabel("Structure name")).toHaveValue("Plot");

    await page.getByRole("button", { name: "Add beat" }).click();
    const beat = page.getByRole("dialog", { name: "New beat" });
    await beat.getByLabel("Beat").fill("Midpoint");
    await beat.getByLabel("What happens").fill("Everything changes.");
    await beat.getByRole("button", { name: "Add beat" }).click();
    await expect(page.getByRole("article", { name: "Midpoint" })).toBeVisible();

    await page.getByRole("button", { name: "Actions for Midpoint" }).click();
    await page.getByRole("menuitem", { name: "Remove beat" }).click();
    const review = page.getByRole("dialog", { name: "Remove the beat “Midpoint”?" });
    await expect(review.getByText("Suggested (your choice)")).toBeVisible();
    await review.getByLabel(/Keep it as a note about this structure/).check();
    await review.getByRole("button", { name: "Remove beat" }).click();
    // The dialog closes only once the server has applied the change.
    await expect(review).toBeHidden();
    await expect(page.getByRole("article", { name: "Midpoint" })).toHaveCount(0);

    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Midpoint/ })).toBeVisible();
  });
});
