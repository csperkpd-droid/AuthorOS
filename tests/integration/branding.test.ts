import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { brand } from "@/config/brand";
import { SIGNED_OUT_COOKIE } from "@/lib/auth/session-cookie";
import { magicLinkContent } from "@/lib/auth/mailer";
import { DRAFTS_DB_NAME } from "@/lib/local-drafts";
import { EXPORT_FORMAT, exportWorkspaceJson } from "@/modules/exports";
import { IMPORT_SOURCES, reviewImport, runImport } from "@/modules/imports";
import { createBook } from "@/modules/library";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * Rebrand Milestone 1: the product is Spellbound Draft (Brand Specification
 * v1.1), but four compatibility identifiers keep the old name on purpose
 * (spec section 14, Compatibility Identifier Rule).
 */

const root = process.cwd();
const read = (file: string) => readFile(path.join(root, file), "utf8");

describe("protected compatibility identifiers", () => {
  it("are unchanged", () => {
    expect(EXPORT_FORMAT).toBe("authoros.workspace"); // backup file format
    expect(DRAFTS_DB_NAME).toBe("authoros-drafts"); // on-device drafts store
    expect(SIGNED_OUT_COOKIE).toBe("authoros-signed-out"); // offline sign-out cookie
    expect(IMPORT_SOURCES.map((s) => s.id)).toContain("authoros-json"); // import source id
  });
});

describe("backups across the rename", () => {
  let ctx: AuthorContext;
  beforeEach(async () => {
    await resetDatabase();
    ctx = await createAuthor("Jane");
  });

  it("names new backups Spellbound Draft but keeps the file format", async () => {
    await createBook(ctx, { title: "Ember" });
    const { data, filename } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(filename).toMatch(/^spellbound-draft-workspace-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data).toMatchObject({ format: "authoros.workspace", app: "Spellbound Draft" });
  });

  it("still restores a backup made before the rename", async () => {
    await createBook(ctx, { title: "Ember" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" }, kind: "archive" });
    // Exactly what AuthorOS wrote: its app name and file name.
    const bytes = new TextEncoder().encode(JSON.stringify({ ...data, app: "AuthorOS" }));
    const file = {
      sourceId: "authoros-json",
      filename: "authoros-workspace-2026-10-01.json",
      bytes,
    };
    await resetDatabase();
    const other = await createAuthor("Jane");

    const review = await reviewImport(other, file);
    expect(review.errors).toEqual([]);
    const result = await runImport(other, file, { token: review.token! });
    expect(result).toBeTruthy();
    const after = await exportWorkspaceJson(other, { scope: { kind: "all" } });
    expect(after.data.books.map((b) => b.title)).toEqual(["Ember"]);
  });
});

describe("sign-in email", () => {
  it("is branded Spellbound Draft and keeps the link exactly", () => {
    const url =
      "https://author-os-eight.vercel.app/api/auth/callback/resend?token=abc&email=a%40b.c";
    const email = magicLinkContent(url);
    expect(email.subject).toBe("Your Spellbound Draft sign-in link");
    expect(email.text).toContain(`Sign in to Spellbound Draft:\n${url}\n`);
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain("Sign in to Spellbound Draft");
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(/AuthorOS/);
      expect(part).not.toContain(brand.tagline); // never in system email
    }
  });
});

/** Every remaining "AuthorOS" in the app's source, by reason (spec section 14). */
const ALLOWED_OLD_NAME = [
  /"authoros\.workspace"/, // compatibility: backup file format
  /"authoros-drafts"/, // compatibility: on-device drafts store
  /"authoros-signed-out"/, // compatibility: offline sign-out cookie
  /"authoros-json"/, // compatibility: import source id
  /authoros:work/, // technical: per-tab Return to Work keys
  /parseAuthorOsJson|\.\/authoros-json"/, // internal function and file name
  /AuthorOS backups work too/, // on purpose: old backups still restore
  /^\s*(\*|\/\/|\/\*)/, // code comments (no author sees them)
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return rel === path.join("src", "generated") ? [] : sourceFiles(rel);
      return /\.(tsx?|css)$/.test(e.name) ? [rel] : [];
    }),
  );
  return files.flat();
}

describe("product name", () => {
  it("leaves no unintended AuthorOS in the app", async () => {
    const unexpected: string[] = [];
    for (const file of await sourceFiles("src")) {
      (await read(file)).split("\n").forEach((line, i) => {
        if (/author[ _.-]?os/i.test(line) && !ALLOWED_OLD_NAME.some((ok) => ok.test(line))) {
          unexpected.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(unexpected).toEqual([]);
  });

  it("keeps the tagline out of the app chrome", async () => {
    const uses = [];
    for (const file of await sourceFiles("src")) {
      if (/brand\.tagline|Where stories cast their spell/.test(await read(file))) uses.push(file);
    }
    // The config that defines it, and the public home page (marketing).
    expect(uses.sort()).toEqual([
      path.join("src", "app", "page.tsx"),
      path.join("src", "config", "brand.ts"),
    ]);
  });
});

/** The `--name: value` declarations of the first block that starts at `marker`. */
function declarations(css: string, marker: string) {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", css.indexOf(":root", start));
  const block = css.slice(open + 1, css.indexOf("}", open));
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

describe("theme tokens", () => {
  it("define every role in light and dark, with the spec's values", async () => {
    const css = await read("src/app/globals.css");
    const light = declarations(css, "/*\n * Design tokens");
    const dark = declarations(css, "@media (prefers-color-scheme: dark)");
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    // A sample of each group: surfaces, text, borders, brand, states, interaction.
    expect(light).toMatchObject({
      "--background": "#f7f1e5",
      "--surface": "#fffdf8",
      "--muted": "#ede3d0",
      "--foreground": "#231b2e",
      "--muted-foreground": "#5e5468",
      "--border-strong": "#8a7d6b",
      "--primary": "#5a2e6e",
      "--surface-brand": "#3a1d49",
      "--accent": "#c08b2c",
      "--success": "#3f5e4c",
      "--warning": "#8c4a0b",
      "--destructive": "#a3322a",
      "--info": "#3d5a80",
      "--selection": "#e3d3ea",
      "--caret": "#5a2e6e",
      "--annotation": "#f3e7c8",
    });
    expect(dark).toMatchObject({
      "--background": "#1c1722",
      "--surface": "#231d2a",
      "--surface-manuscript": "#242028",
      "--foreground": "#ede6da",
      "--text-manuscript": "#e6ded0",
      "--link": "#cfaedd",
      "--primary": "#c9a3da",
      "--primary-foreground": "#1c1722",
      "--accent": "#d1a54b",
      "--success": "#93c2a3",
      "--destructive": "#f2958c",
      "--ring": "#cfaedd",
      "--selection": "#4e3b60",
    });
  });

  it("follow the device theme only (no manual switch)", async () => {
    const css = await read("src/app/globals.css");
    expect(css).not.toMatch(/data-theme|\.dark\b|@custom-variant dark/);
    for (const file of await sourceFiles("src")) {
      expect(await read(file), file).not.toMatch(/data-theme|colorScheme\s*[:=]|setTheme\(/);
    }
  });

  it("assign the three typefaces to their roles", async () => {
    const css = await read("src/app/globals.css");
    const layout = await read("src/app/layout.tsx");
    expect(layout).toMatch(
      /import \{ Cormorant_Garamond, Inter, Literata \} from "next\/font\/google"/,
    );
    expect(css).toMatch(/--font-display: var\(--font-cormorant\)/);
    expect(css).toMatch(/--font-sans: var\(--font-inter\)/);
    expect(css).toMatch(/--font-manuscript: var\(--font-literata\)/);
    expect(css).toMatch(/\.manuscript \{\s*font-family: --theme\(--font-manuscript\)/);
    for (const file of await sourceFiles("src")) {
      expect(await read(file), file).not.toMatch(/\bfont-serif\b/);
    }
  });
});
