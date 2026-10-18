"use client";

import { ListTodo } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

import { createTaskFromCommentAction } from "../actions";
import { taskTitleFromComment } from "../task-title";

/**
 * "Make a task" from a comment (M18, decision 116): a task about the
 * comment's scene or note, its title prefilled from the comment and editable
 * before saving. The comment itself is not changed, and the task isn't
 * linked to it.
 */
export function MakeTaskButton({
  commentId,
  body,
  thing,
}: {
  commentId: string;
  body: string;
  /** "scene" or "note", for the description. */
  thing: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const { run, pending, error, setError } = useAction(createTaskFromCommentAction);
  const id = `make-task-${commentId}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
        if (o) {
          setTitle(taskTitleFromComment(body));
          setMade(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <ListTodo />
          Make a task
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Make a task"
        description={`The task will be about this ${thing}. The comment stays as it is.`}
      >
        {made ? (
          <div role="status" className="space-y-4">
            <p className="text-sm">Task added.</p>
            <div className="flex justify-end gap-2">
              <Link
                href={`/tasks/${made}`}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-hover"
              >
                Open task
              </Link>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await run(commentId, title);
              if (result.ok) setMade(result.data.id);
            }}
          >
            <Field label="Task" htmlFor={id}>
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                required
                autoFocus
              />
            </Field>
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !title.trim()}>
                Add task
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
