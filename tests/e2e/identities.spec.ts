import { expect, test } from "@playwright/test";

import { signUp } from "./support/auth";
import { createBook, switchIdentity } from "./support/manuscript";

test.skip(
  ({ isMobile }) => isMobile,
  "Identity management is covered on desktop; mobile uses the same pages.",
);

test("manages pen names: create, edit, default, switch, archive, restore", async ({ page }) => {
  const email = await signUp(page);
  const handle = email.split("@")[0];

  await page.goto("/identities");
  const list = page.getByRole("list", { name: "Pen names" });
  await expect(list.getByRole("heading", { name: new RegExp(handle) })).toBeVisible();

  // Create
  await page.getByRole("button", { name: "New pen name" }).click();
  let dialog = page.getByRole("dialog", { name: "New pen name" });
  await dialog.getByLabel("Name").fill("Rose Hart");
  await dialog.getByLabel("Bio").fill("Small-town romance.");
  await dialog.getByRole("button", { name: "Create pen name" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole("heading", { name: "Rose Hart" })).toBeVisible();
  await expect(page.getByText("Small-town romance.")).toBeVisible();

  // Edit
  await page.getByRole("button", { name: "Edit Rose Hart" }).click();
  dialog = page.getByRole("dialog", { name: "Edit pen name" });
  await dialog.getByLabel("Name").fill("Rosalind Hart");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("heading", { name: "Rosalind Hart" })).toBeVisible();

  // Switch identity from the sidebar; the library follows it.
  await switchIdentity(page, "Rosalind Hart");
  await expect(list.getByRole("heading", { name: /Rosalind Hart.*Writing as/ })).toBeVisible();
  await createBook(page, "Harbour Lights");
  await page.goto("/library");
  await expect(page.getByText("Writing as Rosalind Hart")).toBeVisible();
  await expect(page.getByRole("link", { name: /Harbour Lights/ })).toBeVisible();

  // Make default, then the old default can be archived and restored.
  await page.goto("/identities");
  await page.getByRole("button", { name: "More actions for Rosalind Hart" }).click();
  await page.getByRole("menuitem", { name: "Make default" }).click();
  await expect(list.getByRole("heading", { name: /Rosalind Hart.*Default/ })).toBeVisible();

  await page.getByRole("button", { name: `More actions for ${handle}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  const archived = page.getByRole("region", { name: "Archived" });
  await expect(archived.getByText(handle)).toBeVisible();
  await expect(page.getByLabel("Writing as").getByRole("option", { name: handle })).toHaveCount(0);

  await archived.getByRole("button", { name: "Restore" }).click();
  await expect(list.getByRole("heading", { name: new RegExp(handle) })).toBeVisible();
});

test("shows every identity's work in All identities", async ({ page }) => {
  await signUp(page);
  await createBook(page, "Mine");
  await page.goto("/identities");
  await page.getByRole("button", { name: "New pen name" }).click();
  const dialog = page.getByRole("dialog", { name: "New pen name" });
  await dialog.getByLabel("Name").fill("Night Writer");
  await dialog.getByRole("button", { name: "Create pen name" }).click();
  await expect(dialog).toBeHidden();
  await switchIdentity(page, "Night Writer");
  await createBook(page, "Theirs");

  await switchIdentity(page, "All identities");
  await page.goto("/library");
  await expect(page.getByRole("main").getByText("All identities")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Night Writer" }).getByRole("link", { name: /Theirs/ }),
  ).toBeVisible();
});
