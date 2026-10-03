"use client";

import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Star,
  UserRoundCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";

import {
  archivePenNameAction,
  restorePenNameAction,
  setDefaultPenNameAction,
  switchIdentityAction,
} from "../actions";
import { PenNameDialog } from "./pen-name-dialog";

type PenName = {
  id: string;
  name: string;
  bio: string | null;
  isDefault: boolean;
  archivedAt: Date | null;
};

export function PenNameMenu({ penName, isActive }: { penName: PenName; isActive: boolean }) {
  const setDefault = useAction(setDefaultPenNameAction);
  const archive = useAction(archivePenNameAction);
  const restore = useAction(restorePenNameAction);
  const switchTo = useAction(switchIdentityAction);
  const error = setDefault.error ?? archive.error ?? restore.error ?? switchTo.error;

  if (penName.archivedAt) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={restore.pending}
          onClick={() => restore.run(penName.id)}
        >
          <ArchiveRestore />
          Restore
        </Button>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <PenNameDialog
        penName={penName}
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Edit ${penName.name}`}>
            <Pencil />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`More actions for ${penName.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={isActive} onSelect={() => switchTo.run(penName.id)}>
            <UserRoundCheck />
            Write as {penName.name}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={penName.isDefault}
            onSelect={() => setDefault.run(penName.id)}
          >
            <Star />
            Make default
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={penName.isDefault}
            onSelect={() => archive.run(penName.id)}
          >
            <Archive />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormError message={error} />
    </div>
  );
}
