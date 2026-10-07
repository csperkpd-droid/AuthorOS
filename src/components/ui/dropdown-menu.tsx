"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align="end"
        sideOffset={4}
        className={cn(
          "z-50 min-w-44 rounded-md border border-border bg-surface-elevated p-1 text-sm shadow-float",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover [&_svg]:size-4",
        destructive && "text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}
