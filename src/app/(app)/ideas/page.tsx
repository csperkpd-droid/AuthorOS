import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { IDEA_STATUS_LABELS, listIdeas } from "@/modules/ideas";
import { IdeaCapture } from "@/modules/ideas/ui";
import { cn } from "@/lib/utils";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Ideas" };

export default async function IdeasPage() {
  const ctx = await requireAuthorContext();
  const ideas = await listIdeas(ctx);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ideas"
        description="Capture sparks; connect them or turn them into books."
      />
      <IdeaCapture />
      {ideas.length > 0 && (
        <ul aria-label="Ideas" className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <li key={idea.id}>
              <Link
                href={`/ideas/${idea.id}`}
                className={cn(
                  "flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-primary/40",
                  idea.status !== "OPEN" && "opacity-70",
                )}
              >
                <p className="font-medium">{idea.title}</p>
                {idea.body && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{idea.body}</p>
                )}
                <Badge className="mt-auto self-start">{IDEA_STATUS_LABELS[idea.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
