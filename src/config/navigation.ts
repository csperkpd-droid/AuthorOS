import {
  CalendarDays,
  ChartGantt,
  HeartHandshake,
  LayoutDashboard,
  Library,
  Lightbulb,
  Rocket,
  SquareCheck,
  StickyNote,
  Trash2,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * The application's feature registry. The sidebar, placeholder pages and the
 * dashboard all read from here, so adding a module means adding one entry.
 */
export type Availability =
  | { status: "available" }
  | { status: "planned"; milestone: string }
  | { status: "later"; release: string };

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  availability: Availability;
  /** Other path prefixes that belong to this section (for the active state). */
  matches?: string[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const navigation: NavGroup[] = [
  {
    label: "Write",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Your writing at a glance.",
        availability: { status: "available" },
      },
      {
        label: "Library",
        href: "/library",
        icon: Library,
        description: "Series, books, parts, chapters and scenes, with the manuscript editor.",
        availability: { status: "available" },
        matches: ["/books"],
      },
      {
        label: "Pen names",
        href: "/identities",
        icon: UserRound,
        description: "Your author identities and the work published under each.",
        availability: { status: "available" },
      },
      {
        label: "Ideas",
        href: "/ideas",
        icon: Lightbulb,
        description: "Capture sparks and promote them into books or series.",
        availability: { status: "planned", milestone: "Milestone 2" },
      },
    ],
  },
  {
    label: "Story bible",
    items: [
      {
        label: "Characters",
        href: "/characters",
        icon: Users,
        description: "Characters, their details and every scene they appear in.",
        availability: { status: "planned", milestone: "Milestone 2" },
      },
      {
        label: "Relationships",
        href: "/relationships",
        icon: HeartHandshake,
        description: "How characters connect, and how that changes scene by scene.",
        availability: { status: "planned", milestone: "Milestone 2" },
      },
      {
        label: "Story structure",
        href: "/structure",
        icon: Workflow,
        description: "Plot and romance beat sheets mapped to your scenes.",
        availability: { status: "planned", milestone: "Milestone 3" },
      },
    ],
  },
  {
    label: "Organize",
    items: [
      {
        label: "Notes",
        href: "/notes",
        icon: StickyNote,
        description: "Research and notes, attached to anything in your story.",
        availability: { status: "planned", milestone: "Milestone 2" },
      },
      {
        label: "Tasks",
        href: "/tasks",
        icon: SquareCheck,
        description: "Writing to-dos with due dates and priorities.",
        availability: { status: "planned", milestone: "Milestone 4" },
      },
      {
        label: "Calendar",
        href: "/calendar",
        icon: CalendarDays,
        description: "Deadlines, events and writing sessions in one view.",
        availability: { status: "planned", milestone: "Milestone 4" },
      },
      {
        label: "Trash",
        href: "/trash",
        icon: Trash2,
        description: "Deleted work, kept until you restore it or delete it forever.",
        availability: { status: "available" },
      },
      {
        label: "Timeline",
        href: "/timeline",
        icon: ChartGantt,
        description: "In-world chronology of events across books.",
        availability: { status: "later", release: "v1.1" },
      },
      {
        label: "Publishing",
        href: "/publishing",
        icon: Rocket,
        description: "Editing, cover, formatting and launch workflows.",
        availability: { status: "later", release: "v1.1" },
      },
    ],
  },
];

export function findNavItem(href: string): NavItem {
  const item = navigation.flatMap((g) => g.items).find((i) => i.href === href);
  if (!item) throw new Error(`No navigation entry for ${href}`);
  return item;
}

export function availabilityLabel(a: Availability): string | null {
  if (a.status === "planned") return a.milestone;
  if (a.status === "later") return a.release;
  return null;
}
