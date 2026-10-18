import { beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { anchorText, makeAnchor } from "@/lib/anchors";
import { addDays, startOfWeek } from "@/lib/dates";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, RuleError } from "@/lib/errors";
import { createEvent, setDeadline, taskWeek } from "@/modules/calendar";
import {
  addComment,
  createTaskFromComment,
  deleteComment,
  setCommentResolved,
} from "@/modules/comments";
import { exportWorkspaceJson } from "@/modules/exports";
import { createBook } from "@/modules/library";
import {
  createChapter,
  createScene,
  getSceneForEditor,
  saveSceneContent,
  trashScene,
} from "@/modules/manuscript";
import { createNote, getNote, saveNoteBody } from "@/modules/notes";
import { createPenName } from "@/modules/pen-names";
import { today as todayFor } from "@/modules/progress";
import {
  BOARD_DONE_DAYS,
  createTask,
  getTask,
  listTaskBoard,
  listTasks,
  listTasksForToday,
  setTaskDueDate,
  setTaskStatus,
  trashTask,
  updateTask,
} from "@/modules/tasks";
import { restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M18 Task views (decision 116): List, Board, Week and Today read the one
 * tasks table; moves change one field; tasks can be made from comments
 * without touching the comment or copying its passage.
 */

let ctx: AuthorContext;
let today: string;

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id);

async function task(title: string, extra: { dueOn?: string; priority?: "LOW" | "HIGH" } = {}) {
  return (await createTask(ctx, { title, ...extra })).id;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  today = await todayFor(ctx);
});

describe("Board", () => {
  it("puts tasks in their status column, in the List's order", async () => {
    const later = await task("Later", { dueOn: addDays(today, 5) });
    const soonLow = await task("Soon, low", { dueOn: addDays(today, 1), priority: "LOW" });
    const soonHigh = await task("Soon, high", { dueOn: addDays(today, 1), priority: "HIGH" });
    const undated = await task("Someday");
    const started = await task("Started");
    await setTaskStatus(ctx, started, "IN_PROGRESS");

    const board = await listTaskBoard(ctx);
    expect(ids(board.TODO)).toEqual([soonHigh, soonLow, later, undated]);
    expect(ids(board.IN_PROGRESS)).toEqual([started]);
    expect(board.DONE).toEqual([]);
    // The same order as the List.
    expect(ids(await listTasks(ctx))).toEqual([soonHigh, soonLow, later, undated, started]);
  });

  it("shows tasks finished in the last 14 days in Done; older ones stay in the List", async () => {
    const recent = await task("Recent");
    const old = await task("Old");
    await setTaskStatus(ctx, recent, "DONE");
    await setTaskStatus(ctx, old, "DONE");
    await db.task.update({
      where: { id: old },
      data: { completedAt: new Date(Date.now() - (BOARD_DONE_DAYS + 1) * 86_400_000) },
    });
    expect(ids((await listTaskBoard(ctx)).DONE)).toEqual([recent]);
    expect(ids(await listTasks(ctx, { status: "done" })).sort()).toEqual([recent, old].sort());
  });

  it("a status move changes only the status (and when it was completed)", async () => {
    const id = await task("Edit chapter 3", { dueOn: addDays(today, 2), priority: "HIGH" });
    await updateTask(ctx, id, {
      title: "Edit chapter 3",
      notes: "Tighten it",
      priority: "HIGH",
      dueOn: addDays(today, 2),
    });
    const before = await db.task.findUniqueOrThrow({ where: { id } });

    await setTaskStatus(ctx, id, "IN_PROGRESS");
    let after = await db.task.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ ...before, status: "IN_PROGRESS", updatedAt: after.updatedAt });
    expect(after.completedAt).toBeNull();

    await setTaskStatus(ctx, id, "DONE");
    after = await db.task.findUniqueOrThrow({ where: { id } });
    expect(after.completedAt).not.toBeNull();
    expect(after).toMatchObject({ title: before.title, notes: before.notes, dueOn: before.dueOn });
    await setTaskStatus(ctx, id, "TODO");
    expect((await db.task.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();
  });

  it("is not filtered by Writing as, and leaves out trashed tasks until restored", async () => {
    const rose = await createPenName(ctx, { name: "Rose Vale" });
    const shared = await task("Shared");
    const trashed = await task("Trashed");
    await trashTask(ctx, trashed);
    const asRose = { ...ctx, activePenNameId: rose.id };
    expect(ids((await listTaskBoard(asRose)).TODO)).toEqual([shared]);
    expect(ids((await listTaskBoard(ctx)).TODO)).toEqual([shared]);
    await restoreFromTrash(ctx, "TASK", trashed);
    expect(ids((await listTaskBoard(asRose)).TODO).sort()).toEqual([shared, trashed].sort());
  });
});

describe("Week", () => {
  it("shows seven days from Monday with tasks on their due day, and both trays", async () => {
    const monday = startOfWeek(today);
    const onMonday = await task("Monday task", { dueOn: monday });
    const onSunday = await task("Sunday task", { dueOn: addDays(monday, 6) });
    const overdue = await task("Overdue", { dueOn: addDays(monday, -3) });
    const undated = await task("No date");
    const nextWeek = await task("Next week", { dueOn: addDays(monday, 8) });
    const doneUndated = await task("Done, no date");
    await setTaskStatus(ctx, doneUndated, "DONE");
    const longDone = await task("Done long ago, no date");
    await setTaskStatus(ctx, longDone, "DONE");
    await db.task.update({
      where: { id: longDone },
      data: { completedAt: new Date(Date.now() - (BOARD_DONE_DAYS + 1) * 86_400_000) },
    });

    const week = await taskWeek(ctx, { weekOf: today, today, penNameId: null });
    expect(week.start).toBe(monday);
    expect(week.days.map((d) => d.date)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n)),
    );
    // Monday is a past day unless today is Monday: then the open task is overdue.
    if (today === monday) expect(ids(week.days[0].tasks)).toEqual([onMonday]);
    else expect(ids(week.days[0].tasks)).toEqual([]);
    expect(ids(week.days[6].tasks)).toEqual([onSunday]);
    expect(ids(week.overdue).sort()).toEqual(
      (today === monday ? [overdue] : [overdue, onMonday]).sort(),
    );
    // Open undated tasks and those finished recently (List order); not older ones.
    expect(ids(week.undated)).toEqual([undated, doneUndated]);
    expect(week.days.flatMap((d) => ids(d.tasks))).not.toContain(nextWeek);

    // An open task due earlier in the week is in Overdue, not on its day;
    // a finished one stays on its day.
    if (today !== monday) {
      const yesterday = addDays(today, -1);
      const late = await task("Late this week", { dueOn: yesterday });
      const finished = await task("Finished this week", { dueOn: yesterday });
      await setTaskStatus(ctx, finished, "DONE");
      const now = await taskWeek(ctx, { weekOf: today, today, penNameId: null });
      const day = now.days.find((d) => d.date === yesterday)!;
      expect(ids(now.overdue)).toContain(late);
      expect(ids(day.tasks)).toEqual([finished]);
    }

    // Another week: the trays stay, the days change.
    const next = await taskWeek(ctx, { weekOf: addDays(monday, 9), today, penNameId: null });
    expect(next.start).toBe(addDays(monday, 7));
    expect(ids(next.days[1].tasks)).toEqual([nextWeek]);
    expect(ids(next.undated)).toEqual([undated, doneUndated]);
  });

  it("refuses an invalid week", async () => {
    await expect(
      taskWeek(ctx, { weekOf: "next tuesday", today, penNameId: null }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("shows events and deadlines as read-only context; deadlines follow Writing as", async () => {
    const monday = startOfWeek(today);
    const rose = await createPenName(ctx, { name: "Rose Vale" });
    const ember = await createBook(ctx, { title: "Ember", penNameId: rose.id });
    const harbour = await createBook(ctx, { title: "Harbour Lights" });
    await setDeadline(ctx, ember.id, addDays(monday, 2));
    await setDeadline(ctx, harbour.id, addDays(monday, 2));
    await createEvent(ctx, { title: "Writing retreat", startsOn: addDays(monday, 2) });

    const all = await taskWeek(ctx, { weekOf: monday, today, penNameId: null });
    expect(all.days[2].entries.map((e) => e.title).sort()).toEqual(
      ["Ember due", "Harbour Lights due", "Writing retreat"].sort(),
    );
    expect(all.days[2].tasks).toEqual([]);
    const asRose = await taskWeek(ctx, { weekOf: monday, today, penNameId: rose.id });
    expect(asRose.days[2].entries.map((e) => e.title).sort()).toEqual([
      "Ember due",
      "Writing retreat",
    ]);
    // No task was made from an event or deadline.
    expect(await listTasks(ctx, { status: "all" })).toEqual([]);
  });

  it("a day move changes only the due date; No date clears it", async () => {
    const monday = startOfWeek(today);
    const id = await task("Outline", { dueOn: today, priority: "HIGH" });
    await setTaskStatus(ctx, id, "IN_PROGRESS");
    const before = await db.task.findUniqueOrThrow({ where: { id } });

    await setTaskDueDate(ctx, id, addDays(monday, 6));
    let after = await db.task.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({
      title: before.title,
      notes: before.notes,
      status: "IN_PROGRESS",
      priority: "HIGH",
      completedAt: null,
    });
    const week = await taskWeek(ctx, { weekOf: monday, today, penNameId: null });
    expect(ids(week.days[6].tasks)).toEqual([id]);

    await setTaskDueDate(ctx, id, null);
    after = await db.task.findUniqueOrThrow({ where: { id } });
    expect(after.dueOn).toBeNull();
    expect(after.status).toBe("IN_PROGRESS");

    await expect(setTaskDueDate(ctx, id, "2026-02-30")).rejects.toThrow();
    await expect(setTaskDueDate(ctx, id, "soon")).rejects.toThrow();
  });

  it("the last of two moves wins and full edits keep their stale-form check", async () => {
    const id = await task("Query letter", { dueOn: today });
    const loaded = await getTask(ctx, id);
    await setTaskDueDate(ctx, id, addDays(today, 1));
    await setTaskDueDate(ctx, id, addDays(today, 2));
    expect((await getTask(ctx, id)).dueOn).toBe(addDays(today, 2));
    // A form opened before the moves is refused, not silently applied.
    await expect(
      updateTask(
        ctx,
        id,
        { title: "Query letter v2", dueOn: today },
        { expectedUpdatedAt: loaded.updatedAt.toISOString() },
      ),
    ).rejects.toThrow();
    expect((await getTask(ctx, id)).title).toBe("Query letter");
  });
});

describe("Today", () => {
  it("lists open tasks overdue or due today, and tasks in progress", async () => {
    const overdue = await task("Overdue", { dueOn: addDays(today, -2) });
    const due = await task("Due today", { dueOn: today });
    const future = await task("Tomorrow", { dueOn: addDays(today, 1) });
    const undated = await task("No date");
    const started = await task("Started, due later", { dueOn: addDays(today, 4) });
    await setTaskStatus(ctx, started, "IN_PROGRESS");
    const doneToday = await task("Done today", { dueOn: today });
    await setTaskStatus(ctx, doneToday, "DONE");

    const list = ids(await listTasksForToday(ctx, today));
    expect(list).toEqual([overdue, due, started]);
    expect(list).not.toContain(future);
    expect(list).not.toContain(undated);
  });

  it("shows the same task the same way in every view", async () => {
    const id = await task("Same everywhere", { dueOn: today, priority: "HIGH" });
    const [fromList] = await listTasks(ctx);
    const [fromBoard] = (await listTaskBoard(ctx)).TODO;
    const week = await taskWeek(ctx, { weekOf: today, today, penNameId: null });
    const fromWeek = week.days.find((d) => d.date === today)!.tasks[0];
    const [fromToday] = await listTasksForToday(ctx, today);
    for (const view of [fromBoard, fromWeek, fromToday]) expect(view).toEqual(fromList);
    expect(fromList.id).toBe(id);
  });
});

describe("Make a task from a comment", () => {
  let sceneId: string;
  let bookId: string;

  async function commentOn(nodeId: string, quote: string, body: string, as = ctx) {
    const node = await db.storyNode.findUniqueOrThrow({ where: { id: nodeId } });
    const saved =
      node.kind === "SCENE"
        ? (await getSceneForEditor(as, nodeId)).scene
        : { ...(await getNote(as, nodeId)), content: (await getNote(as, nodeId)).body };
    const text = anchorText(saved.content);
    const start = text.indexOf(quote);
    return addComment(as, nodeId, {
      version: saved.version,
      ...makeAnchor(text, start, start + quote.length),
      body,
    });
  }

  beforeEach(async () => {
    bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
    const chapter = await createChapter(ctx, bookId, { title: "One" });
    sceneId = (await createScene(ctx, chapter.id, "The storm")).id;
    const { scene } = await getSceneForEditor(ctx, sceneId);
    await saveSceneContent(ctx, {
      sceneId,
      content: doc("The storm came in at dusk.", "Mara ran to the quay."),
      baseVersion: scene.version,
    });
  });

  it("creates a task about the scene with the chosen title; the comment and text are untouched", async () => {
    const comment = await commentOn(sceneId, "Mara ran to the quay.", "Too fast here?");
    const commentBefore = await db.comment.findUniqueOrThrow({ where: { id: comment.id } });
    const sceneBefore = (await getSceneForEditor(ctx, sceneId)).scene;

    const { id } = await createTaskFromComment(ctx, comment.id, {
      title: "Slow down the quay scene",
    });
    const made = await getTask(ctx, id);
    expect(made).toMatchObject({
      title: "Slow down the quay scene",
      notes: null,
      status: "TODO",
      dueOn: null,
    });
    expect(made.concerns.map((c) => c.id)).toEqual([sceneId]);
    // The quoted passage is not copied anywhere on the task.
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row)).not.toContain("Mara ran to the quay.");

    expect(await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).toEqual(
      commentBefore,
    );
    const sceneAfter = (await getSceneForEditor(ctx, sceneId)).scene;
    expect({
      v: sceneAfter.version,
      words: sceneAfter.wordCount,
      content: sceneAfter.content,
    }).toEqual({
      v: sceneBefore.version,
      words: sceneBefore.wordCount,
      content: sceneBefore.content,
    });
  });

  it("works for notes, and task and comment stay independent", async () => {
    const note = await createNote(ctx, { title: "Research" });
    await saveNoteBody(ctx, {
      noteId: note.id,
      content: doc("Lamps burned whale oil."),
      baseVersion: 0,
    });
    const comment = await commentOn(note.id, "whale oil", "Check the source.");
    const { id } = await createTaskFromComment(ctx, comment.id, { title: "Check the source." });
    expect((await getTask(ctx, id)).concerns.map((c) => c.id)).toEqual([note.id]);

    // Completing the task leaves the comment open; resolving the comment leaves the task.
    await setTaskStatus(ctx, id, "DONE");
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).state).toBe("OPEN");
    await setTaskStatus(ctx, id, "TODO");
    await setCommentResolved(ctx, comment.id, true);
    expect((await getTask(ctx, id)).status).toBe("TODO");
  });

  it("refuses an empty title", async () => {
    const comment = await commentOn(sceneId, "Mara ran to the quay.", "Too fast?");
    await expect(createTaskFromComment(ctx, comment.id, { title: "   " })).rejects.toThrow();
    expect(await listTasks(ctx, { status: "all" })).toEqual([]);
  });

  it("treats a deleted comment, a trashed scene and another workspace's comment as not found", async () => {
    const deleted = await commentOn(sceneId, "Mara ran to the quay.", "Gone");
    await deleteComment(ctx, deleted.id);
    await expect(createTaskFromComment(ctx, deleted.id, { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const hidden = await commentOn(sceneId, "The storm came in at dusk.", "Hidden");
    await trashScene(ctx, sceneId);
    await expect(createTaskFromComment(ctx, hidden.id, { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await restoreFromTrash(ctx, "SCENE", sceneId);

    const other = await createAuthor("Other");
    await expect(createTaskFromComment(other, hidden.id, { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createTaskFromComment(ctx, "00000000-0000-7000-8000-000000000000", { title: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listTasks(ctx, { status: "all" })).toEqual([]);
    expect(await listTasks(other, { status: "all" })).toEqual([]);
  });

  it("needs planning edit rights: a viewer is refused", async () => {
    const comment = await commentOn(sceneId, "Mara ran to the quay.", "Too fast?");
    const viewer = { ...ctx, role: "VIEWER" as WorkspaceRole };
    await expect(createTaskFromComment(viewer, comment.id, { title: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("isolation, permissions and data", () => {
  it("never shows or moves another workspace's tasks", async () => {
    const mine = await task("Mine", { dueOn: today });
    const other = await createAuthor("Other");
    const theirs = (await createTask(other, { title: "Theirs", dueOn: today })).id;

    expect(ids((await listTaskBoard(ctx)).TODO)).toEqual([mine]);
    expect(ids(await listTasksForToday(ctx, today))).toEqual([mine]);
    const week = await taskWeek(ctx, { weekOf: today, today, penNameId: null });
    expect(week.days.flatMap((d) => ids(d.tasks))).toEqual([mine]);

    await expect(setTaskDueDate(ctx, theirs, today)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaskStatus(ctx, theirs, "DONE")).rejects.toBeInstanceOf(NotFoundError);
    expect((await getTask(other, theirs)).status).toBe("TODO");
  });

  it("viewers see the views but can't move tasks; no access sees nothing", async () => {
    const id = await task("Plan", { dueOn: today });
    const viewer = { ...ctx, role: "VIEWER" as WorkspaceRole };
    expect(ids((await listTaskBoard(viewer)).TODO)).toEqual([id]);
    await expect(setTaskDueDate(viewer, id, null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTaskStatus(viewer, id, "DONE")).rejects.toBeInstanceOf(ForbiddenError);

    const none = { ...ctx, role: "NO_ACCESS" as WorkspaceRole };
    await expect(listTaskBoard(none)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTasksForToday(none, today)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(taskWeek(none, { weekOf: today, today, penNameId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keeps the export format and every task field", async () => {
    const id = await task("Exported", { dueOn: today, priority: "HIGH" });
    await setTaskStatus(ctx, id, "IN_PROGRESS");
    const { data: bundle } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(bundle.version).toBe(9);
    expect(bundle.tasks).toEqual([
      expect.objectContaining({ id, title: "Exported", status: "IN_PROGRESS", priority: "HIGH" }),
    ]);
  });
});
