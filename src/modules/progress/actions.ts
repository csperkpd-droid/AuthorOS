"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { WritingLogInput } from "./schemas";
import { deleteWritingLog, hasTimeZone, logWriting, setDailyGoal, setTimeZone } from "./service";

export async function setDailyGoalAction(words: string | null) {
  return runAction(async () => setDailyGoal(await requireAuthorContext(), words));
}

export async function logWritingAction(input: WritingLogInput) {
  return runAction(async () => logWriting(await requireAuthorContext(), input));
}

export async function deleteWritingLogAction(id: string) {
  return runAction(async () => deleteWritingLog(await requireAuthorContext(), id));
}

export async function setTimeZoneAction(timeZone: string) {
  return runAction(async () => setTimeZone(await requireAuthorContext(), timeZone));
}

/**
 * Records the browser's time zone the first time the author visits, so
 * "today" matches their day. Never overrides a zone they chose.
 */
export async function detectTimeZoneAction(timeZone: string) {
  return runAction(
    async () => {
      const ctx = await requireAuthorContext();
      if (!(await hasTimeZone(ctx))) await setTimeZone(ctx, timeZone);
      return null;
    },
    { refresh: false },
  );
}
