import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { StoryNodeKind } from "@/generated/prisma/enums";
import { NODE_KIND_LABELS } from "@/modules/story-graph/ui";

type Node = { kind: StoryNodeKind; title: string; context: string | null; href: string };

/** A link to any story object: kind, title and where it lives. */
export function NodeLink({ node, showKind = true }: { node: Node; showKind?: boolean }) {
  return (
    <Link href={node.href} className="group flex min-w-0 items-center gap-2">
      {showKind && <Badge className="shrink-0">{NODE_KIND_LABELS[node.kind].one}</Badge>}
      <span className="min-w-0 truncate">
        <span className="font-medium group-hover:text-primary group-hover:underline">
          {node.title}
        </span>
        {node.context && <span className="text-sm text-muted-foreground"> · {node.context}</span>}
      </span>
    </Link>
  );
}
