"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Item = { id: string };

/**
 * A vertically sortable list (mouse, touch and keyboard: focus a handle,
 * Space to lift, arrows to move, Space to drop). Calls `onMove(id, afterId)`
 * with the item now directly above (null = first) and reorders optimistically.
 */
export function SortableList<T extends Item>({
  items,
  label,
  itemLabel,
  onMove,
  renderItem,
  className,
}: {
  items: T[];
  /** Accessible name of the list, e.g. "Scenes in Chapter 1". */
  label: string;
  /** How screen readers name an item while it is being moved, e.g. its title. */
  itemLabel: (item: T) => string;
  onMove: (id: string, afterId: string | null) => Promise<unknown>;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  // Optimistic order; resets whenever the server sends a new list.
  const [order, setOrder] = useState(items);
  const [source, setSource] = useState(items);
  if (items !== source) {
    setSource(items);
    setOrder(items);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.findIndex((i) => i.id === active.id);
    const to = order.findIndex((i) => i.id === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    const index = next.findIndex((i) => i.id === active.id);
    await onMove(String(active.id), index > 0 ? next[index - 1].id : null);
  }

  const name = (id: string | number) => {
    const item = order.find((i) => i.id === id);
    return item ? itemLabel(item) : "Item";
  };
  const place = (id: string | number) =>
    `position ${order.findIndex((i) => i.id === id) + 1} of ${order.length}`;
  // A stable id keeps dnd-kit's generated ARIA ids equal on server and client.
  const dndId = useId();
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    // dnd-kit reports the item over its own starting slot right after pick-up;
    // only announce real moves.
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id ? `${name(active.id)} moved to ${place(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} dropped at ${place(over.id)}.` : undefined,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} cancelled.`,
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className={className}>
          {order.map((item) => (
            <SortableRow key={item.id} id={item.id} render={(handle) => renderItem(item, handle)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, render }: { id: string; render: (handle: ReactNode) => ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-surface-hover focus-visible:focus-ring active:cursor-grabbing"
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-80")}
    >
      {render(handle)}
    </li>
  );
}
