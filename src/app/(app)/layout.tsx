import { redirect } from "next/navigation";

import { Brand } from "@/components/shell/brand";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { listPenNames } from "@/modules/pen-names";
import { IdentitySwitcher } from "@/modules/pen-names/ui";
import { getSessionUser, requireAuthorContext } from "@/server/context";

// The layout fetches the user and identities for the shell UI only.
// Authorization happens in each page via requireAuthorContext(), because
// layouts don't re-render on navigation (see docs/ARCHITECTURE.md → Authorization).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const ctx = await requireAuthorContext();
  const penNames = await listPenNames(ctx);
  const switcher = (
    <IdentitySwitcher
      penNames={penNames.map((p) => ({ id: p.id, name: p.name }))}
      activePenNameId={ctx.activePenNameId}
    />
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-6 py-5">
          <Brand />
        </div>
        <div className="px-4 pb-4">{switcher}</div>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav />
        </div>
        <div className="px-3 pb-4">
          <UserMenu user={user} />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <Brand />
        <MobileNav header={switcher} footer={<UserMenu user={user} />} />
      </header>

      <main className="min-w-0 px-4 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
