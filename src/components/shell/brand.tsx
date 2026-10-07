import { Feather } from "lucide-react";
import Link from "next/link";

import { brand } from "@/config/brand";

/**
 * The horizontal lockup: mark + wordmark ("Spellbound" Cormorant 600, "Draft"
 * Cormorant italic 500). The Feather icon holds the place of the Open Page
 * mark until the production vector artwork exists; swap it here, nowhere else.
 */
export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label={brand.product}
      className="flex items-center gap-2 font-display text-[1.3125rem] leading-none tracking-[-0.008em] text-foreground"
    >
      <Feather className="size-5 text-primary" aria-hidden />
      <span>
        <span className="font-semibold">Spellbound</span>{" "}
        <span className="font-medium italic">Draft</span>
      </span>
    </Link>
  );
}

/** "By Scrollkeep Studio": the quiet endorsement on sign-in and the public home page. */
export function Endorsement({ className }: { className?: string }) {
  return (
    <p
      className={`text-[0.6875rem] font-medium tracking-[0.25em] text-muted-foreground uppercase ${className ?? ""}`}
    >
      By {brand.company}
    </p>
  );
}
