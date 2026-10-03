import { LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/modules/auth";
import type { SessionUser } from "@/server/context";

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <div className="space-y-1 border-t border-border pt-4">
      <div className="px-3 pb-2">
        <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
        {user.name && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
      </div>
      <Link
        href="/settings"
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
      >
        <Settings className="size-4" aria-hidden />
        Settings
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </form>
    </div>
  );
}
