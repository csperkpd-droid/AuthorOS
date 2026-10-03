import { Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDay } from "@/lib/dates";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { today } from "@/modules/progress";
import { getTask } from "@/modules/tasks";
import { TASK_PRIORITY_LABELS, TaskDialog, TaskList, trashTaskAction } from "@/modules/tasks/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/tasks/[taskId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const task = await orNotFound(getTask(ctx, (await params).taskId));
  return { title: task.title };
}

export default async function TaskPage({ params }: Props) {
  const { taskId } = await params;
  const ctx = await requireAuthorContext();
  const [task, connections, todayDate] = await Promise.all([
    orNotFound(getTask(ctx, taskId)),
    listConnections(ctx, taskId),
    today(ctx),
  ]);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/tasks" className="hover:text-foreground">
          Tasks
        </Link>
      </nav>
      <PageHeader
        title={task.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <TaskDialog
              task={task}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move task to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${task.title}” to the Trash?`}
              description="You can restore it from the Trash."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashTaskAction.bind(null, task.id)}
              navigateTo="/tasks"
            />
          </div>
        }
      />
      <TaskList tasks={[task]} today={todayDate} label="This task" />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge>{TASK_PRIORITY_LABELS[task.priority]} priority</Badge>
        {task.dueOn && <Badge>Due {formatDay(task.dueOn)}</Badge>}
      </div>
      {task.notes && <p className="max-w-prose whitespace-pre-line">{task.notes}</p>}
      <ConnectionsPanel
        nodeId={task.id}
        nodeKind="TASK"
        connections={connections}
        heading="For"
        emptyText="Connect this task to the book, scene, character or anything else it’s for."
      />
    </div>
  );
}
