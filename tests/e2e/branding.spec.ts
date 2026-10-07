import { expect, test, type Locator, type Page } from "@playwright/test";

import { signUp } from "./support/auth";
import { editorText, expectSaved } from "./support/manuscript";
import { createBookWithScene } from "./support/story-bible";

/**
 * Rebrand Milestone 1: Spellbound Draft (Brand Specification v1.1) in the
 * rendered UI. Light and dark follow the device; contrast is measured on the
 * real elements (spec section 8, validation gate).
 */

/**
 * WCAG contrast of an element's text, border or focus outline against the
 * background it sits on (the first opaque background up the tree).
 */
async function contrast(locator: Locator, what: "text" | "border" | "outline" = "text") {
  return locator.evaluate((el, what) => {
    const rgb = (c: string) => {
      const m = c.match(/[\d.]+/g)!.map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // Behind the element: the first opaque background up the tree.
    let node: Element | null = what === "text" ? el : el.parentElement;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node) {
      const c = rgb(getComputedStyle(node).backgroundColor);
      if (c.a > 0.99) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const style = getComputedStyle(el);
    const fg = rgb(
      what === "border"
        ? style.borderTopColor
        : what === "outline"
          ? style.outlineColor
          : style.color,
    );
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }, what);
}

const css = (locator: Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(0);
}

test("the public pages say Spellbound Draft", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Spellbound Draft");
  await expect(page.getByRole("link", { name: "Spellbound Draft" })).toBeVisible();
  // The home page is the one marketing surface where the tagline belongs.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Where stories cast their spell.",
  );
  await expect(page.getByText("Spellbound Draft is made by Scrollkeep Studio.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/AuthorOS/i);
  await noOverflow(page);

  await page.goto("/sign-in");
  await expect(page).toHaveTitle(/Spellbound Draft/);
  await expect(page.getByRole("link", { name: "Spellbound Draft" })).toBeVisible();
  await expect(page.getByText("By Scrollkeep Studio")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/AuthorOS|Where stories cast/i);
  await noOverflow(page);
});

const THEMES = {
  light: { background: "rgb(247, 241, 229)", manuscript: "rgb(35, 27, 46)" },
  dark: { background: "rgb(28, 23, 34)", manuscript: "rgb(230, 222, 208)" },
} as const;

for (const scheme of ["light", "dark"] as const) {
  test(`the app in the device's ${scheme} theme: brand, typefaces, contrast`, async ({
    page,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await signUp(page);

    await page.goto("/dashboard");
    await expect(page).toHaveTitle(/ · Spellbound Draft$/);
    await expect(page.getByRole("link", { name: "Spellbound Draft" }).first()).toBeVisible();
    const body = page.locator("body");
    expect(await css(body, "background-color")).toBe(THEMES[scheme].background);
    await expect(body).not.toContainText(/AuthorOS|Where stories cast/i);

    // Typefaces by role: Cormorant titles, Inter UI, Literata manuscript.
    const title = page.getByRole("heading", { level: 1 });
    expect(await css(title, "font-family")).toMatch(/Cormorant/);
    expect(await css(body, "font-family")).toMatch(/Inter/);
    expect(await contrast(title)).toBeGreaterThanOrEqual(4.5);
    await noOverflow(page);

    // Navigation (sidebar on desktop, menu on phone).
    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    const current = nav.getByRole("link", { name: "Dashboard" });
    await expect(current).toHaveAttribute("aria-current", "page");
    expect(await contrast(current)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(nav.getByRole("link", { name: "Library" }))).toBeGreaterThanOrEqual(4.5);
    if (isMobile) await page.getByRole("button", { name: "Close menu" }).click();

    // The manuscript.
    await createBookWithScene(page, `Lantern ${scheme}`);
    const editor = editorText(page);
    await editor.click();
    await page.keyboard.type("The lamp was lit.");
    await expectSaved(page);
    const manuscript = page.locator(".manuscript");
    expect(await css(manuscript, "font-family")).toMatch(/Literata/);
    expect(await css(manuscript, "color")).toBe(THEMES[scheme].manuscript);
    expect(await css(manuscript, "font-size")).toBe(isMobile ? "17px" : "19px");
    expect(await contrast(manuscript)).toBeGreaterThanOrEqual(7);
    expect(await css(manuscript, "caret-color")).not.toBe(await css(manuscript, "color"));
    // Saved is quiet sage, and readable.
    const status = page.getByTestId("save-status");
    expect(await contrast(status)).toBeGreaterThanOrEqual(4.5);

    // Controls: buttons, inputs (3:1 borders), focus.
    await page.goto("/library");
    const primary = page.getByRole("button", { name: "New book" }).first();
    expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "New series" }).click();
    const dialog = page.getByRole("dialog", { name: "New series" });
    const input = dialog.getByLabel("Title", { exact: true });
    expect(await contrast(input, "border")).toBeGreaterThanOrEqual(3);
    // Keyboard focus: a solid 2px outline, at least 3:1 against the dialog.
    await input.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    expect(await css(input, "outline-style")).toBe("solid");
    expect(await css(input, "outline-width")).toBe("2px");
    expect(await contrast(input, "outline")).toBeGreaterThanOrEqual(3);
    await noOverflow(page);
  });
}

/**
 * The app follows the device theme as it changes (manual-test regression,
 * Rebrand 1): dark on, then off, then on again in the same tab, live and
 * after a reload, including the manuscript. Proves the response to the
 * preference, not just that both palettes exist.
 */
test("follows the device theme when it changes", async ({ page }) => {
  test.setTimeout(120_000);
  const body = page.locator("body");
  const expectTheme = async (scheme: "light" | "dark") => {
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
      scheme === "dark",
    );
    expect(await css(body, "background-color")).toBe(THEMES[scheme].background);
  };

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectTheme("dark");
  await page.emulateMedia({ colorScheme: "light" }); // device dark mode turned off
  await expectTheme("light");
  await page.reload();
  await expectTheme("light");
  await page.emulateMedia({ colorScheme: "dark" }); // and on again
  await expectTheme("dark");

  // The manuscript switches with it: page text, caret and selection.
  await signUp(page);
  await createBookWithScene(page, "Night and day");
  await editorText(page).click();
  await page.keyboard.type("The lamp was lit.");
  await expectSaved(page);
  const manuscript = page.locator(".manuscript");
  const look = () =>
    manuscript.evaluate((el) => ({
      font: getComputedStyle(el).fontFamily,
      color: getComputedStyle(el).color,
      caret: getComputedStyle(el).caretColor,
      selection: getComputedStyle(el.querySelector("p")!, "::selection").backgroundColor,
    }));
  const dark = await look();
  expect(dark).toMatchObject({
    color: THEMES.dark.manuscript,
    caret: "rgb(201, 163, 218)",
    selection: "rgb(78, 59, 96)",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme("light");
  const light = await look();
  expect(light).toMatchObject({
    color: THEMES.light.manuscript,
    caret: "rgb(90, 46, 110)",
    selection: "rgb(227, 211, 234)",
  });
  expect(dark.font).toMatch(/Literata/);
  expect(light.font).toMatch(/Literata/);
  expect(await contrast(manuscript)).toBeGreaterThanOrEqual(7);
});
