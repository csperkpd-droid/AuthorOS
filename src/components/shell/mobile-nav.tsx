"use client";

import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ header, footer }: { header?: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="sm"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X /> : <Menu />}
      </Button>
      {open && (
        <div className="fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t border-border bg-background p-4">
          {header && <div className="mb-6">{header}</div>}
          <SidebarNav onNavigate={() => setOpen(false)} />
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      )}
    </div>
  );
}
