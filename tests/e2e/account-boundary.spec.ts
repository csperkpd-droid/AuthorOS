import { expect, test, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { uniqueEmail } from "./support/outbox";
import { createBookWithScene } from "./support/story-bible";

type StoredDraft = {
  key: string;
  owner?: string;
  item?: string;
  content: unknown;
  baseVersion: number;
  writtenAt: number;
};

/** Every draft record on this device (all accounts), straight from IndexedDB. */
function storedDrafts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<StoredDraft[]>((resolve, reject) => {
        const request = indexedDB.open("authoros-drafts", 1);
        request.onsuccess = () => {
          const read = request.result.transaction("drafts").objectStore("drafts").getAll();
          read.onsuccess = () => resolve(read.result as StoredDraft[]);
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Saves to the cloud fail for scene pages (Server Action posts are aborted). */
async function blockSceneSaves(page: Page) {
  await page.route("**/books/**/scenes/**", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort()
      : route.continue(),
  );
}

const warning = (page: Page) =>
  page.getByRole("dialog", { name: "Some writing isn’t saved to the cloud yet" });

test.describe("Milestone 9: unsynced writing belongs to one account", () => {
  test.skip(({ isMobile }) => isMobile, "Exercised on desktop.");

  test("signing out with unsynced writing warns; staying signed in lets it sync", async ({
    page,
    context,
  }) => {
    await signUp(page);
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("The tide came in.");
    await expectSaved(page);

    await context.setOffline(true);
    await page.keyboard.type(" The lamps went out.");
    const status = page.getByTestId("save-status");
    await expect(status).toHaveText("Saved on this device · offline, will sync");

    await page.getByRole("button", { name: "Sign out" }).click();
    const dialog = warning(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Not yet in the cloud" })).toContainText(
      "Scene 1 · Harbour Lights",
    );
    await expect(dialog).toContainText("stays on this device only");
    // Never claims the writing is safe in the cloud.
    await expect(dialog).not.toContainText("synced");
    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toHaveText("The tide came in. The lamps went out.");

    await context.setOffline(false);
    await expectSaved(page);
    await expect(status).toContainText("Saved to the cloud");
    // Nothing is waiting any more: signing out goes straight through.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("offline: Sign out anyway signs out, keeps the writing on this device, uploads nothing", async ({
    page,
    context,
  }) => {
    const author = uniqueEmail();
    await signUp(page, author);
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Saved line.");
    await expectSaved(page);

    await context.setOffline(true);
    await page.keyboard.type(" Offline line.");
    await expect(page.getByTestId("save-status")).toHaveText(
      "Saved on this device · offline, will sync",
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await warning(page).getByRole("button", { name: "Sign out anyway" }).click();

    // Signed out here and now, and told where the writing is.
    const signedOut = page.getByRole("alertdialog", { name: "You’re signed out on this device" });
    await expect(signedOut).toBeVisible();
    await expect(signedOut).toContainText("only on this device");
    // Everything behind it is out of reach (can't be focused or typed into).
    const appInert = await page.evaluate(() =>
      [...document.body.children]
        .filter((el) => !el.querySelector('[role="alertdialog"]'))
        .every((el) => (el as HTMLElement).inert),
    );
    expect(appInert).toBe(true);

    // Watch for any save reaching the server once the connection returns.
    const saves: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) saves.push(r.url());
    });
    await context.setOffline(false);
    await expect(page).toHaveURL(/\/sign-in/);
    expect(saves).toEqual([]);

    // The session is really gone, and the writing is still on this device, owned.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
    const kept = await storedDrafts(page);
    expect(kept).toHaveLength(1);
    expect(kept[0].owner).toBeTruthy();

    // The author signs in again and gets it back.
    await signUp(page, author);
    await page.goto(sceneUrl);
    await expect(page.getByTestId("draft-recovery")).toContainText(
      "Restored text from this device",
    );
    await expect(editorText(page)).toHaveText("Saved line. Offline line.");
    await expectSaved(page);
  });

  test("a link to the sign-out address alone signs nobody out", async ({ page }) => {
    await signUp(page);
    await page.goto("/sign-out");
    // Still signed in: the sign-in page sends a signed-in author on to the dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("signing out straight after typing still warns", async ({ page, context }) => {
    await signUp(page);
    await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("The tide came in.");
    await expectSaved(page);
    await context.setOffline(true);
    // No pause: the click lands before the usual short delay for the device copy.
    await page.keyboard.type(" The lamps went out.");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(warning(page)).toContainText("Scene 1 · Harbour Lights");
    await warning(page).getByRole("button", { name: "Stay signed in" }).click();
    await expect(page.getByTestId("save-status")).toHaveText(
      "Saved on this device · offline, will sync",
    );
  });

  test("another account never sees it; its author gets it back after signing in again", async ({
    page,
  }) => {
    const author = uniqueEmail();
    await signUp(page, author);
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Saved line.");
    await expectSaved(page);

    await blockSceneSaves(page);
    await page.keyboard.type(" Unsynced line.");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved on this device/);

    // Leave the scene (in-app navigation), then sign out anyway.
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(warning(page)).toContainText("Scene 1 · Harbour Lights");
    await warning(page).getByRole("button", { name: "Sign out anyway" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.unroute("**/books/**/scenes/**");

    // The writing was not destroyed: it is still on this device, owned by the author.
    const kept = await storedDrafts(page);
    expect(kept).toHaveLength(1);
    expect(kept[0].owner).toBeTruthy();

    // A second account on the same browser.
    await signUp(page, uniqueEmail());
    const response = await page.goto(sceneUrl);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("draft-recovery")).toHaveCount(0);
    await page.goto("/dashboard");
    // Nothing of the first account's is waiting for this one: no warning.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // The author signs in again and gets the writing back, then it syncs.
    await signUp(page, author);
    await page.goto(sceneUrl);
    await expect(page.getByTestId("draft-recovery")).toContainText(
      "Restored text from this device",
    );
    await expect(editorText(page)).toHaveText("Saved line. Unsynced line.");
    await expectSaved(page);
    await page.reload();
    await expect(editorText(page)).toHaveText("Saved line. Unsynced line.");
    expect(await storedDrafts(page)).toHaveLength(0);
  });

  test("a draft saved before drafts had owners is adopted only by the account that can open it", async ({
    page,
  }) => {
    await signUp(page);
    const sceneUrl = await createBookWithScene(page, "Harbour Lights");
    await editorText(page).click();
    await page.keyboard.type("Saved line.");
    await expectSaved(page);

    await blockSceneSaves(page);
    await page.keyboard.type(" Older device line.");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved on this device/);

    // Rewrite the draft as a version 8 draft: keyed by the scene alone, no owner.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("authoros-drafts", 1);
          request.onsuccess = () => {
            const tx = request.result.transaction("drafts", "readwrite");
            const store = tx.objectStore("drafts");
            const all = store.getAll();
            all.onsuccess = () => {
              const [draft] = all.result as StoredDraft[];
              store.delete(draft.key);
              store.put({
                key: draft.item,
                content: draft.content,
                baseVersion: draft.baseVersion,
                writtenAt: draft.writtenAt,
              });
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    expect((await storedDrafts(page))[0].owner).toBeUndefined();

    await page.reload();
    await expect(page.getByTestId("draft-recovery")).toContainText(
      "Restored text from this device",
    );
    await expect(editorText(page)).toHaveText("Saved line. Older device line.");
    const adopted = await storedDrafts(page);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].owner).toBeTruthy();
    expect(adopted[0].key).toBe(`${adopted[0].owner}|${adopted[0].item}`);

    // The cloud answers again: the adopted text syncs.
    await page.unroute("**/books/**/scenes/**");
    await expectSaved(page);
    await page.goto(sceneUrl);
    await expect(editorText(page)).toHaveText("Saved line. Older device line.");
  });
});
