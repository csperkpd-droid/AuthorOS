import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import * as calendar from "@/modules/calendar";
import * as characters from "@/modules/characters";
import * as connections from "@/modules/connections";
import * as exportsModule from "@/modules/exports";
import * as fields from "@/modules/fields";
import * as history from "@/modules/history";
import * as ideas from "@/modules/ideas";
import * as impact from "@/modules/impact";
import * as imports from "@/modules/imports";
import * as library from "@/modules/library";
import * as manuscript from "@/modules/manuscript";
import * as notes from "@/modules/notes";
import * as penNames from "@/modules/pen-names";
import * as progress from "@/modules/progress";
import * as relationships from "@/modules/relationships";
import * as search from "@/modules/search";
import * as storyGraph from "@/modules/story-graph";
import * as structure from "@/modules/structure";
import * as tasks from "@/modules/tasks";
import * as trash from "@/modules/trash";
import * as workContext from "@/modules/work-context";
import * as workspaces from "@/modules/workspaces";
import type { AuthorContext } from "@/server/context";
import { can, ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

const MODULES = {
  calendar,
  characters,
  connections,
  exports: exportsModule,
  fields,
  history,
  ideas,
  impact,
  imports,
  library,
  manuscript,
  notes,
  penNames,
  progress,
  relationships,
  search,
  storyGraph,
  structure,
  tasks,
  trash,
  workContext,
  workspaces,
} as Record<string, Record<string, unknown>>;

/** Names of services that change data. */
const WRITES =
  /^(create|update|trash|restore|delete|set|move|rename|save|apply|assign|unassign|add|dissolve|connect|disconnect|log|promote|archive|empty|run|review|export|keep)(?=[A-Z]|$)/;

/**
 * Writes that need no role: personal preferences of the member, and
 * internal steps called inside another service's checked transaction.
 */
const NOT_ROLE_CHECKED = new Set([
  "storyGraph.createStoryNode", // inside a checked service's transaction
  "connections.createPlannedConnection", // applies a plan made by a checked service
  "penNames.setActiveIdentity", // the member's own "Writing as"
  "progress.setDailyGoal", // the member's own goal
  "progress.setTimeZone", // the member's own time zone
  "workContext.setWritingPlace", // the member's own place (needs view of the scene)
  "progress.recordEditorWords", // inside the scene save's transaction
  "imports.readUpload", // transport helper
  "exports.exportScopeInput", // a schema
]);

let owner: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  owner = await createAuthor("Jane");
});

describe("authorization in the data layer", () => {
  it("every service that changes data refuses a viewer before doing anything", async () => {
    const viewer: AuthorContext = { ...owner, role: "VIEWER" };
    const checked: string[] = [];
    const before = await db.storyNode.count();
    for (const [moduleName, api] of Object.entries(MODULES)) {
      for (const [name, value] of Object.entries(api)) {
        const id = `${moduleName}.${name}`;
        if (typeof value !== "function" || !WRITES.test(name) || NOT_ROLE_CHECKED.has(id)) continue;
        if (/Input$|Schema$/.test(name)) continue;
        const call = () =>
          (value as (...args: unknown[]) => unknown)(viewer, "x", "x", { token: "x" });
        await expect(Promise.resolve().then(call), id).rejects.toBeInstanceOf(ForbiddenError);
        checked.push(id);
      }
    }
    expect(checked.length).toBeGreaterThan(80);
    expect(await db.storyNode.count()).toBe(before);
  });

  it("editors work on the story but don't manage the workspace", async () => {
    const editor: AuthorContext = { ...owner, role: "EDITOR" };
    const book = await library.createBook(editor, { title: "Shared draft" });
    const chapter = await manuscript.createChapter(editor, book.id);
    await manuscript.createScene(editor, chapter.id, "Opening");
    await expect(penNames.createPenName(editor, { name: "Alias" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await library.trashBook(editor, book.id);
    await trash.restoreFromTrash(editor, "BOOK", book.id);
    await library.trashBook(editor, book.id);
    await expect(trash.deleteForever(editor, "BOOK", book.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      exportsModule.exportWorkspaceJson(editor, { scope: { kind: "all" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Reading stays open to every member, viewers included.
    const viewer: AuthorContext = { ...owner, role: "VIEWER" };
    expect((await trash.listTrash(viewer)).map((t) => t.id)).toEqual([book.id]);
  });

  it("grants: owners everything, editors contribute, viewers view", () => {
    expect(can({ role: "OWNER" }, "manage", "workspace")).toBe(true);
    expect(can({ role: "EDITOR" }, "edit", "manuscript")).toBe(true);
    expect(can({ role: "EDITOR" }, "suggest", "storyBible")).toBe(true);
    expect(can({ role: "EDITOR" }, "manage", "identity")).toBe(false);
    expect(can({ role: "VIEWER" }, "view", "manuscript")).toBe(true);
    expect(can({ role: "VIEWER" }, "comment", "manuscript")).toBe(false);
    expect(can({ role: "VIEWER" }, "edit", "any")).toBe(false);
    expect(Object.keys(ROLE_GRANTS).sort()).toEqual(["EDITOR", "OWNER", "VIEWER"]);
  });
});
