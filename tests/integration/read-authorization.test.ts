import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/errors";
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
import * as workspaces from "@/modules/workspaces";
import type { AuthorContext } from "@/server/context";
import { assertCanView, canView, ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M9: reads are authorized below the UI, by the same grants as writes.
 * Workspace membership alone grants nothing.
 */

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
  workspaces,
} as Record<string, Record<string, unknown>>;

/** Names of services that change data (checked by authorization.test.ts). */
const WRITES =
  /^(create|update|trash|restore|delete|set|move|rename|save|apply|assign|unassign|add|dissolve|connect|disconnect|log|promote|archive|empty|run|review|export|keep)(?=[A-Z]|$)/;

/**
 * Exports that return no author data of their own, with the reason. Every
 * other exported function of a module is a read and must be checked.
 */
const NOT_A_READ = new Set([
  // Pure functions over the registries or their arguments (no data access).
  "connections.canConnect",
  "connections.connectionOptionsFor",
  "connections.getKind",
  "connections.isConnectionKind",
  "connections.labelFrom",
  "exports.checkExportIntegrity",
  "history.isLargeEdit",
  "history.isVersionedKind",
  "history.wordsRemoved",
  "impact.affectsOthers",
  "impact.assertReviewed",
  "impact.buildReport",
  "progress.streakFrom",
  "relationships.memberKey",
  "relationships.relationshipTitle",
  "search.parseQuery",
  "search.toPrefixQuery",
  "storyGraph.adapterFor",
  "storyGraph.kindForBundleKey",
  "storyGraph.kindsWhere",
  "storyGraph.relationshipTitle",
  "storyGraph.sameIdentity",
  "storyGraph.storyObjectType",
  "storyGraph.viewableKinds",
  // Steps inside a checked write's transaction.
  "history.recordFieldHistory",
  "progress.recordEditorWords",
  "storyGraph.purgeStoryNodes",
  // The member's own settings, not author data.
  "progress.getDailyGoal",
  "progress.getTimeZone",
  "progress.hasTimeZone",
  "progress.today",
  // Transport helpers of the import route (the import itself is checked).
  "imports.ImportFileError",
  "imports.isSameOrigin",
  "imports.readUpload",
  // Sign-in bootstrap: runs before a member context exists.
  "workspaces.ensurePersonalWorkspace",
  "workspaces.findPrimaryMembership",
  "workspaces.getWorkspace",
]);

/** A test-only role, registered in the real grants table for one test. */
function withRole(name: string, grants: (typeof ROLE_GRANTS)[WorkspaceRole]) {
  (ROLE_GRANTS as Record<string, unknown>)[name] = grants;
  return name as WorkspaceRole;
}

const missingId = "00000000-0000-7000-8000-000000000000";

let owner: AuthorContext;
let noAccess: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  owner = await createAuthor("Jane");
  // A member whose role grants nothing (as a project-only collaborator
  // would be outside their projects). Unknown roles fail closed.
  noAccess = { ...owner, role: "NO_ACCESS" as WorkspaceRole };
});

afterEach(() => {
  delete (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER;
});

async function failure(promise: () => unknown) {
  try {
    await promise();
  } catch (error) {
    return error;
  }
  return null;
}

describe("reads are authorized in the data layer (M9)", () => {
  it("every service that returns author data refuses a member who may not view it", async () => {
    const book = await library.createBook(owner, { title: "Ember" });
    const checked: string[] = [];
    for (const [moduleName, api] of Object.entries(MODULES)) {
      for (const [name, value] of Object.entries(api)) {
        const id = `${moduleName}.${name}`;
        if (typeof value !== "function" || WRITES.test(name) || NOT_A_READ.has(id)) continue;
        if (/Input$|Schema$/.test(name)) continue;
        for (const target of [book.id, missingId]) {
          const error = await failure(() =>
            (value as (...args: unknown[]) => unknown)(noAccess, target, target, {}),
          );
          expect(error, `${id} must refuse`).toBeInstanceOf(DomainError);
          expect(
            [ForbiddenError, NotFoundError].some((c) => error instanceof c),
            id,
          ).toBe(true);
        }
        checked.push(id);
      }
    }
    expect(checked.length).toBeGreaterThan(65);
  });

  it("a refused read of an object can't be told apart from a missing object", async () => {
    const book = await library.createBook(owner, { title: "Ember" });
    const chapter = await manuscript.createChapter(owner, book.id);
    const scene = await manuscript.createScene(owner, chapter.id, "Storm");
    const mara = await characters.createCharacter(owner, { name: "Mara" });
    const reads: [(id: string) => Promise<unknown>, string][] = [
      [(id) => library.getBook(noAccess, id), book.id],
      [(id) => manuscript.getSceneForEditor(noAccess, id), scene.id],
      [(id) => characters.getCharacter(noAccess, id), mara.id],
      [(id) => connections.listConnections(noAccess, id), book.id],
      [(id) => history.listRevisions(noAccess, id), scene.id],
    ];
    for (const [read, existing] of reads) {
      const forExisting = await failure(() => read(existing));
      const forMissing = await failure(() => read(missingId));
      expect(forExisting).toBeInstanceOf(NotFoundError);
      expect(forMissing).toBeInstanceOf(NotFoundError);
      expect((forExisting as Error).message).toBe((forMissing as Error).message);
    }
  });

  it("another workspace's objects are not found, never revealed", async () => {
    const book = await library.createBook(owner, { title: "Ember" });
    const mara = await characters.createCharacter(owner, { name: "Mara Quinn" });
    await notes.createNote(owner, { title: "Ember research", aboutId: book.id });
    await library.trashBook(owner, (await library.createBook(owner, { title: "Old draft" })).id);

    const other = await createAuthor("Sam");
    const byOtherForBook = await failure(() => library.getBook(other, book.id));
    const byOtherForMissing = await failure(() => library.getBook(other, missingId));
    expect(byOtherForBook).toBeInstanceOf(NotFoundError);
    expect((byOtherForBook as Error).message).toBe((byOtherForMissing as Error).message);
    await expect(characters.getCharacter(other, mara.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(connections.listConnections(other, book.id)).rejects.toBeInstanceOf(NotFoundError);

    expect(await search.search(other, { query: "Ember" })).toEqual([]);
    expect(await search.search(other, { query: "Mara" })).toEqual([]);
    expect((await storyGraph.resolveNodes(other, [book.id, mara.id])).size).toBe(0);
    expect(await storyGraph.nodeKind(other, book.id)).toBeNull();
    expect(
      await storyGraph.searchNodes(other, { query: "", kinds: ["BOOK", "CHARACTER"] }),
    ).toEqual([]);
    expect(await trash.listTrash(other)).toEqual([]);
    const backup = JSON.stringify(
      await exportsModule.exportWorkspaceJson(other, { scope: { kind: "all" } }),
    );
    expect(backup).not.toContain(book.id);
    expect(backup).not.toContain("Mara Quinn");
  });

  it("owners, editors and viewers read as before", async () => {
    const book = await library.createBook(owner, { title: "Ember" });
    const mara = await characters.createCharacter(owner, { name: "Mara" });
    for (const role of ["OWNER", "EDITOR", "VIEWER"] as const) {
      const ctx = { ...owner, role };
      expect((await library.getBook(ctx, book.id)).title).toBe("Ember");
      expect((await characters.getCharacter(ctx, mara.id)).name).toBe("Mara");
      expect((await search.search(ctx, { query: "Ember" })).map((r) => r.node.id)).toContain(
        book.id,
      );
      expect((await storyGraph.resolveNodes(ctx, [book.id, mara.id])).size).toBe(2);
    }
  });

  it("the Story Graph funnel drops what a role may not view", async () => {
    const book = await library.createBook(owner, { title: "Ember" });
    const mara = await characters.createCharacter(owner, { name: "Ember's keeper" });
    await characters.trashCharacter(owner, mara.id);
    const restored = await characters.createCharacter(owner, { name: "Mara" });
    // A role that may view the manuscript only (how project-level access
    // will narrow what a member sees: through the same funnel).
    const reader: AuthorContext = {
      ...owner,
      role: withRole("MANUSCRIPT_READER", {
        identity: [],
        manuscript: ["view"],
        storyBible: [],
        structure: [],
        planning: [],
        workspace: [],
      }),
    };
    expect(canView(reader, "manuscript")).toBe(true);
    expect(canView(reader, "storyBible")).toBe(false);

    const resolved = await storyGraph.resolveNodes(reader, [book.id, restored.id]);
    expect([...resolved.keys()]).toEqual([book.id]);
    expect(await storyGraph.nodeKind(reader, restored.id)).toBeNull();
    expect(
      (await storyGraph.searchNodes(reader, { query: "", kinds: ["BOOK", "CHARACTER"] })).map(
        (n) => n.id,
      ),
    ).toEqual([book.id]);
    expect((await search.search(reader, { query: "Ember" })).map((r) => r.node.id)).toEqual([
      book.id,
    ]);
    expect(await trash.listTrash(reader)).toEqual([]);
    await expect(characters.getCharacter(reader, restored.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(characters.listCharacters(reader)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await library.getBook(reader, book.id)).title).toBe("Ember");
    // Viewing grants no writes.
    await expect(library.trashBook(reader, book.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refusals: a named object is not found, a list is forbidden; unknown roles fail closed", () => {
    expect(canView({ role: "NO_ACCESS" as WorkspaceRole }, "any")).toBe(false);
    expect(() => assertCanView(noAccess, "manuscript")).toThrow(ForbiddenError);
    expect(() => assertCanView(noAccess, "manuscript", { kind: "BOOK", id: missingId })).toThrow(
      NotFoundError,
    );
    expect(() => assertCanView(owner, "any")).not.toThrow();
  });
});
