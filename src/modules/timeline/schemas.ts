import { z } from "zod";

/** A free-form narrative-time label ("Day 3, evening"). Never a date. */
const label = z
  .string()
  .trim()
  .max(200, "Keep the story time under 200 characters.")
  .transform((v) => v || null)
  .nullable();

/** Placing (or moving) a scene in Story Time: right after `afterId` (null = first). */
export const placementInput = z.object({
  afterId: z.uuid().nullable(),
  label: label.optional(),
});

export const storyTimeLabelInput = z.object({
  label,
  /** The label the author started from: refused if it changed since. */
  expected: z.string().nullable().optional(),
});

export const timelineEventInput = z.object({
  title: z.string().trim().min(1, "Give the event a name.").max(300),
  label: label.optional(),
  description: z.string().max(20_000).nullable().optional(),
});

export const newTimelineEventInput = timelineEventInput.extend({
  /** The book or series that owns it. */
  ownerId: z.uuid(),
  /** Placed right after this scene or event (null = first; omitted = at the end). */
  afterId: z.uuid().nullable().optional(),
});

export type PlacementInput = z.input<typeof placementInput>;
export type StoryTimeLabelInput = z.input<typeof storyTimeLabelInput>;
export type TimelineEventInput = z.input<typeof timelineEventInput>;
export type NewTimelineEventInput = z.input<typeof newTimelineEventInput>;
