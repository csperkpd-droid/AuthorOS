import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { getIdea } from "@/modules/ideas";
import { IdeaForm, trashIdeaAction } from "@/modules/ideas/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/ideas/[ideaId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const idea = await orNotFound(getIdea(ctx, (await params).ideaId));
  return { title: idea.title };
}

export default async function IdeaPage({ params }: Props) {
  const { ideaId } = await params;
  const ctx = await requireAuthorContext();
  const [idea, connections] = await Promise.all([
    orNotFound(getIdea(ctx, ideaId)),
    listConnections(ctx, ideaId),
  ]);

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <nav aria-label="Breadcrumb">
          <Link href="/ideas" className="hover:text-foreground">
            Ideas
          </Link>
        </nav>
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" aria-label="Move idea to Trash">
              <Trash2 />
            </Button>
          }
          title="Move this idea to the Trash?"
          description="You can restore it, with its connections, from the Trash."
          confirmLabel="Move to Trash"
          destructive
          onConfirm={trashIdeaAction.bind(null, idea.id)}
          navigateTo="/ideas"
        />
      </div>
      <IdeaForm key={idea.id} idea={idea} />
      <ConnectionsPanel
        nodeId={idea.id}
        nodeKind="IDEA"
        connections={connections}
        emptyText="Connect what this idea inspired: a book, a character, a scene…"
      />
    </div>
  );
}
