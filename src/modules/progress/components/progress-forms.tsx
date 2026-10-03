"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";

import {
  detectTimeZoneAction,
  logWritingAction,
  setDailyGoalAction,
  setTimeZoneAction,
} from "../actions";

/** Sets or clears the words-per-day goal. */
export function DailyGoalDialog({ goal, trigger }: { goal: number | null; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction(setDailyGoalAction);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Daily word goal" description="Leave it empty for no goal.">
        <form
          className="space-y-4"
          action={async (formData) => {
            const value = String(formData.get("goal") ?? "");
            if ((await run(value === "" ? null : value)).ok) setOpen(false);
          }}
        >
          <Field label="Words per day" htmlFor="daily-goal">
            <Input
              id="daily-goal"
              name="goal"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={goal ?? ""}
              className="w-40"
              autoFocus
            />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              Save goal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Logs words written elsewhere (on paper, in another app). */
export function LogWordsDialog({
  today,
  books,
  trigger,
}: {
  today: string;
  books: { id: string; title: string }[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction(logWritingAction);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Log words"
        description="For words written outside AuthorOS. Words you write here are counted automatically."
      >
        <form
          className="space-y-4"
          action={async (formData) => {
            const result = await run({
              date: String(formData.get("date") ?? ""),
              words: String(formData.get("words") ?? ""),
              bookId: String(formData.get("bookId") ?? ""),
              minutes: String(formData.get("minutes") ?? ""),
              note: String(formData.get("note") ?? ""),
            });
            if (result.ok) setOpen(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Words" htmlFor="log-words">
              <Input
                id="log-words"
                name="words"
                type="number"
                min={1}
                inputMode="numeric"
                required
                autoFocus
              />
            </Field>
            <Field label="Day" htmlFor="log-date">
              <Input
                id="log-date"
                name="date"
                type="date"
                max={today}
                defaultValue={today}
                required
              />
            </Field>
            <Field label="Book (optional)" htmlFor="log-book">
              <Select id="log-book" name="bookId" defaultValue="">
                <option value="">No particular book</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Minutes (optional)" htmlFor="log-minutes">
              <Input id="log-minutes" name="minutes" type="number" min={1} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor="log-note">
            <Input id="log-note" name="note" />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              Log words
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reports the browser's time zone once, if the author hasn't chosen one. */
export function TimeZoneSync({ needed }: { needed: boolean }) {
  useEffect(() => {
    if (!needed) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) void detectTimeZoneAction(tz);
  }, [needed]);
  return null;
}

/** Chooses the time zone that decides what "today" is. */
export function TimeZoneSetting({ timeZone, zones }: { timeZone: string; zones: string[] }) {
  const { run, pending, error } = useAction(setTimeZoneAction);
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <Field
        label="Time zone"
        htmlFor="time-zone"
        hint="Decides when your writing day starts, for daily words, streaks and due dates."
      >
        <Select
          id="time-zone"
          defaultValue={timeZone}
          disabled={pending}
          onChange={async (e) => {
            setSaved(false);
            if ((await run(e.target.value)).ok) setSaved(true);
          }}
          className="max-w-sm"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Saved
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
