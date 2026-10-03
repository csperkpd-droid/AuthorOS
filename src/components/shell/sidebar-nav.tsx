"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { availabilityLabel, navigation } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="space-y-6">
      {navigation.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = [item.href, ...(item.matches ?? [])].some(
                (href) => pathname === href || pathname.startsWith(href + "/"),
              );
              const badge = availabilityLabel(item.availability);
              const isLater = item.availability.status === "later";
              const content = (
                <>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {badge.replace("Milestone ", "M")}
                    </span>
                  )}
                </>
              );
              const classes = cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                isLater && "cursor-default text-muted-foreground hover:bg-transparent",
              );
              return (
                <li key={item.href}>
                  {isLater ? (
                    <span className={classes} aria-disabled="true">
                      {content}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className={classes}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                    >
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
