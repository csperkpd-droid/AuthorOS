"use client";

import {
  closestCenter,
  DndContext,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoveRight } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormError } from "@/components/ui/field";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type LaneTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  concerns: { id: string; title: string; href: string }[];
};

export type Lane = {
  id: string;
  label: string;
  /** Shown above the cards (e.g. a day's events). */
  header?: ReactNode;
  /** Shown below the cards (e.g. "All done tasks"). */
  footer?: ReactNode;
  empty: string;
  tasks: LaneTask[];
  /** Tasks can be moved here (an Overdue tray can't). */
  droppable?: boolean;
  /** Highlighted (today). */
  current?: boolean;
  className?: string;
};

/**
 * Tasks in lanes (M18): the Board's columns or the Week's days. A card moves
 * to another lane by dragging its handle (mouse, touch, or the keyboard:
 * Space to lift, arrows to go from lane to lane, Space to drop) or through
 * its "Move to" menu. Lanes are ordered by the server; a move only changes
 * which lane a card is in (`onMove`), never its order within the lane.
 */
export function TaskLanes({
  lanes,
  label,
  today,
  onMove,
  className,
  laneClassName,
}: {
  lanes: Lane[];
  label: string;
  /** The author's today, to flag overdue tasks. */
  today: string;
  onMove: (taskId: string, laneId: string) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
  laneClassName?: string;
}) {
  // Optimistic lane per task; reset whenever the server sends new lanes.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [source, setSource] = useState(lanes);
  const [error, setError] = useState<string | null>(null);
  if (lanes !== source) {
    setSource(lanes);
    setMoved({});
  }
  const targets = lanes.filter((l) => l.droppable !== false);
  const laneOf = (task: LaneTask) =>
    moved[task.id] ?? lanes.find((l) => l.tasks.some((t) => t.id === task.id))!.id;
  const all = lanes.flatMap((l) => l.tasks);
  const shown = (lane: Lane) =>
    all.filter((t, i) => all.findIndex((x) => x.id === t.id) === i && laneOf(t) === lane.id);

  async function move(task: LaneTask, laneId: string) {
    if (laneOf(task) === laneId) return;
    setError(null);
    const before = moved[task.id];
    // A refused move puts the card back where it was.
    const undo = (message: string) => {
      setError(message);
      setMoved((m) => {
        const next = { ...m };
        if (before) next[task.id] = before;
        else delete next[task.id];
        return next;
      });
    };
    setMoved((m) => ({ ...m, [task.id]: laneId }));
    try {
      const result = await onMove(task.id, laneId);
      if (!result.ok) undo(result.error ?? "That didn’t work. Try again.");
    } catch {
      undo("That didn’t work. Check your connection and try again.");
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: laneKeyboardCoordinates(targets.map((l) => l.id)),
    }),
  );
  const taskName = (id: string | number) => all.find((t) => t.id === id)?.title ?? "Task";
  const startLane = (id: string | number) => {
    const task = all.find((t) => t.id === id);
    return task ? laneOf(task) : null;
  };
  const laneName = (id: string | number) => lanes.find((l) => l.id === id)?.label ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${taskName(active.id)}.`,
    // A lifted card starts over its own lane; only announce other lanes.
    onDragOver: ({ active, over }) =>
      over && over.id !== startLane(active.id)
        ? `${taskName(active.id)} is over ${laneName(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${taskName(active.id)} moved to ${laneName(over.id)}.` : undefined,
    onDragCancel: ({ active }) => `Moving ${taskName(active.id)} cancelled.`,
  };
  const dndId = useId();

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const task = all.find((t) => t.id === active.id);
    if (!task || !over) return;
    await move(task, String(over.id));
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{ announcements }}
      >
        <div role="group" aria-label={label} className={className}>
          {lanes.map((lane) => (
            <LaneBox key={lane.id} lane={lane} count={shown(lane).length} className={laneClassName}>
              {shown(lane).length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">{lane.empty}</p>
              ) : (
                <ul aria-label={lane.label} className="space-y-2">
                  {shown(lane).map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      today={today}
                      targets={targets.filter((l) => l.id !== laneOf(task))}
                      onMove={(laneId) => void move(task, laneId)}
                    />
                  ))}
                </ul>
              )}
            </LaneBox>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function LaneBox({
  lane,
  count,
  className,
  children,
}: {
  lane: Lane;
  count: number;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: lane.id,
    disabled: lane.droppable === false,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={lane.label}
      data-lane={lane.id}
      className={cn(
        "min-w-0 space-y-2 rounded-xl border border-border bg-surface p-3",
        lane.current && "border-primary/50",
        isOver && "border-primary bg-secondary",
        className,
        lane.className,
      )}
    >
      <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span className={cn("min-w-0 break-words", lane.current && "text-primary")}>
          {lane.label}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {count}
          <span className="sr-only"> tasks</span>
        </span>
      </h3>
      {lane.header}
      {children}
      {lane.footer}
    </section>
  );
}

function TaskCard({
  task,
  today,
  targets,
  onMove,
}: {
  task: LaneTask;
  today: string;
  targets: Lane[];
  onMove: (laneId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  const done = task.status === "DONE";
  const overdue = !done && task.dueOn !== null && task.dueOn < today;
  return (
    <li
      ref={setNodeRef}
      data-task={task.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "relative flex items-start gap-1 rounded-lg border border-border bg-surface-elevated p-2 text-sm",
        isDragging && "z-10 opacity-80 shadow-float",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${task.title}`}
        className="hidden size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-surface-hover focus-visible:focus-ring active:cursor-grabbing md:flex"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1 space-y-1 py-0.5">
        <Link
          href={`/tasks/${task.id}`}
          className={cn(
            "block font-medium break-words hover:underline",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </Link>
        {task.concerns.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {task.concerns.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <Link href={c.href} className="hover:text-foreground hover:underline">
                  {c.title}
                </Link>
              </span>
            ))}
          </p>
        )}
        {(task.priority === "HIGH" || task.dueOn) && (
          <div className="flex flex-wrap gap-1">
            {task.priority === "HIGH" && !done && (
              <Badge className="bg-secondary text-primary">High</Badge>
            )}
            {task.dueOn && (
              <Badge className={overdue ? "bg-destructive-bg text-destructive" : undefined}>
                {overdue ? "Overdue · " : ""}
                {formatDay(task.dueOn, { weekday: "short", month: "short" })}
              </Badge>
            )}
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Move ${task.title} to…`}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover focus-visible:focus-ring"
          >
            <MoveRight className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={`Move ${task.title} to`}>
          {targets.map((lane) => (
            <DropdownMenuItem key={lane.id} onSelect={() => onMove(lane.id)}>
              {lane.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * Keyboard moves between lanes: an arrow key takes the lifted card to the
 * centre of the next (or previous) lane, in the order lanes are shown.
 */
function laneKeyboardCoordinates(order: string[]): KeyboardCoordinateGetter {
  return (event, { context }) => {
    const { active, collisionRect, droppableRects, over } = context;
    if (!active || !collisionRect) return undefined;
    const forward = [KeyboardCode.Right, KeyboardCode.Down].includes(event.code as KeyboardCode);
    const back = [KeyboardCode.Left, KeyboardCode.Up].includes(event.code as KeyboardCode);
    if (!forward && !back) return undefined;
    event.preventDefault();
    // Before the first move dnd-kit may not know the lane yet: use the one
    // the card is in.
    const cx = collisionRect.left + collisionRect.width / 2;
    const cy = collisionRect.top + collisionRect.height / 2;
    const under = order.findIndex((id) => {
      const r = droppableRects.get(id);
      return r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    });
    const current = over ? order.indexOf(String(over.id)) : under;
    const next = Math.min(order.length - 1, Math.max(0, current + (forward ? 1 : -1)));
    const rect = droppableRects.get(order[next]);
    if (!rect) return undefined;
    return {
      x: rect.left + rect.width / 2 - collisionRect.width / 2,
      y: rect.top + Math.min(rect.height / 2, 40) - collisionRect.height / 2,
    };
  };
}
