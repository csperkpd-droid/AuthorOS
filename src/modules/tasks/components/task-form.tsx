"use client";

import { Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TaskPriority } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createTaskAction, updateTaskAction } from "../actions";
import { TASK_PRIORITY_LABELS } from "../labels";

/** One-line task capture, optionally already concerning a story object. */
export function QuickAddTask({ concernsId }: { concernsId?: string }) {
  const { run, pending, error } = useAction(createTaskAction);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      aria-label="Add a task"
      className="flex flex-wrap items-end gap-2"
      action={async (formData) => {
        const result = await run({
          title: String(formData.get("title") ?? ""),
          dueOn: String(formData.get("dueOn") ?? ""),
          concernsId: concernsId ?? null,
        });
        if (result.ok) form.current?.reset();
      }}
    >
      <div className="min-w-48 flex-1">
        <label htmlFor="quick-task" className="sr-only">
          New task
        </label>
        <Input id="quick-task" name="title" placeholder="Add a task…" required />
      </div>
      <div>
        <label htmlFor="quick-task-due" className="sr-only">
          Due date
        </label>
        <Input id="quick-task-due" name="dueOn" type="date" className="w-40" />
      </div>
      <Button type="submit" disabled={pending}>
        <Plus />
        Add
      </Button>
      <div className="w-full">
        <FormError message={error} />
      </div>
    </form>
  );
}

type Task = {
  id: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  dueOn: string | null;
};

/** Create a task (optionally about a story object) or edit one. */
export function TaskDialog({
  task,
  concerns,
  trigger,
}: {
  task?: Task;
  concerns?: { id: string; title: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const create = useAction(createTaskAction);
  const update = useAction(updateTaskAction);
  const id = task?.id ?? "new-task";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={task ? "Task details" : "New task"}
        description={concerns ? `For “${concerns.title}”.` : undefined}
      >
        <form
          className="space-y-4"
          action={async (formData) => {
            const input = {
              title: String(formData.get("title") ?? ""),
              notes: String(formData.get("notes") ?? ""),
              priority: formData.get("priority") as TaskPriority,
              dueOn: String(formData.get("dueOn") ?? ""),
            };
            const result = task
              ? await update.run(task.id, input)
              : await create.run({ ...input, concernsId: concerns?.id ?? null });
            if (result.ok) setOpen(false);
          }}
        >
          <Field label="Task" htmlFor={`${id}-title`}>
            <Input id={`${id}-title`} name="title" defaultValue={task?.title} required autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" htmlFor={`${id}-due`}>
              <Input id={`${id}-due`} name="dueOn" type="date" defaultValue={task?.dueOn ?? ""} />
            </Field>
            <Field label="Priority" htmlFor={`${id}-priority`}>
              <Select
                id={`${id}-priority`}
                name="priority"
                defaultValue={task?.priority ?? "NORMAL"}
              >
                {Object.values(TaskPriority).map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor={`${id}-notes`}>
            <Textarea id={`${id}-notes`} name="notes" rows={3} defaultValue={task?.notes ?? ""} />
          </Field>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.pending || update.pending}>
              {task ? "Save" : "Add task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
