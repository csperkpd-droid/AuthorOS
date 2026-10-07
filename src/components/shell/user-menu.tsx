import { Settings } from "lucide-react";
import Link from "next/link";

import type { SessionUser } from "@/server/context";

import { SignOutButton } from "./sign-out-button";

export function UserMenu({ user, draftOwner }: { user: SessionUser; draftOwner: string }) {
  return (
    <div className="space-y-1 border-t border-border pt-4">
      <div className="px-3 pb-2">
        <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
        {user.name && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
      </div>
      <Link
        href="/settings"
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-hover"
      >
        <Settings className="size-4" aria-hidden />
        Settings
      </Link>
      <SignOutButton draftOwner={draftOwner} />
    </div>
  );
}
