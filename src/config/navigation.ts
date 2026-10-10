import {
  CalendarDays,
  Download,
  ChartGantt,
  HeartHandshake,
  LayoutDashboard,
  Library,
  Lightbulb,
  MessageSquareText,
  MapPin,
  Orbit,
  Rocket,
  Search,
  SquareCheck,
  StickyNote,
  Tags,
  Trash2,
  Upload,
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
        label: "Search",
        href: "/search",
        icon: Search,
        description: "Find anything: words in scenes and notes, characters, books, structures.",
        availability: { status: "available" },
      },
      {
        label: "Review",
        href: "/review",
        icon: MessageSquareText,
        description: "Comments across your scenes and notes, and the ones that need review.",
        availability: { status: "available" },
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
        availability: { status: "available" },
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
        availability: { status: "available" },
      },
      {
        label: "Relationships",
        href: "/relationships",
        icon: HeartHandshake,
        description: "How characters connect, and how that changes scene by scene.",
        availability: { status: "available" },
      },
      {
        label: "Places",
        href: "/places",
        icon: MapPin,
        description: "Where your stories happen, and every scene set there.",
        availability: { status: "available" },
      },
      {
        label: "World",
        href: "/world-entries",
        icon: Orbit,
        description: "Organizations, items and anything else in your story worlds.",
        availability: { status: "available" },
      },
      {
        label: "Story structure",
        href: "/structure",
        icon: Workflow,
        description: "Plot and romance beat sheets mapped to your scenes.",
        availability: { status: "available" },
      },
      {
        label: "Tropes",
        href: "/tropes",
        icon: Tags,
        description: "Your tropes, and every book, series and relationship that uses them.",
        availability: { status: "available" },
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
        availability: { status: "available" },
      },
      {
        label: "Tasks",
        href: "/tasks",
        icon: SquareCheck,
        description: "Writing to-dos with due dates and priorities.",
        availability: { status: "available" },
      },
      {
        label: "Calendar",
        href: "/calendar",
        icon: CalendarDays,
        description: "Deadlines, events, due tasks and the words you wrote, in one view.",
        availability: { status: "available" },
      },
      {
        label: "Export",
        href: "/export",
        icon: Download,
        description: "Manuscripts (Word, Markdown) and a full structured backup.",
        availability: { status: "available" },
      },
      {
        label: "Import",
        href: "/import",
        icon: Upload,
        description:
          "Restore a Spellbound Draft backup (AuthorOS backups work too), or bring a workspace from another account.",
        availability: { status: "available" },
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
        description: "When things happen in your story: scenes and events in story order.",
        availability: { status: "available" },
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
