"use client";

import { useState } from "react";

import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";

import { renameOutlineAction } from "../actions";

/** The structure's name, editable in place. */
export function OutlineTitle({ id, title }: { id: string; title: string }) {
  const [value, setValue] = useState(title);
  const rename = useAction(renameOutlineAction);
  return (
    <>
      <input
        aria-label="Structure name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (next && next !== title) void rename.run(id, next);
          else setValue(title);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full rounded-md bg-transparent px-1 font-serif text-3xl tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <FormError message={rename.error} />
    </>
  );
}
