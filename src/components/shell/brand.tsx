import { Feather } from "lucide-react";
import Link from "next/link";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-serif text-xl tracking-tight">
      <Feather className="size-5 text-primary" aria-hidden />
      AuthorOS
    </Link>
  );
}
