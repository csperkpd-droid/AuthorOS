import { availabilityLabel, findNavItem } from "@/config/navigation";

import { PageHeader } from "./page-header";

/** Placeholder for a section whose module has not been built yet. */
export function ComingSoon({ href }: { href: string }) {
  const item = findNavItem(href);
  const Icon = item.icon;
  const when = availabilityLabel(item.availability);

  return (
    <div className="space-y-8">
      <PageHeader title={item.label} description={item.description} />
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <Icon className="size-10 text-muted-foreground" aria-hidden />
        <p className="mt-4 font-display text-2xl font-semibold">Coming in {when}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This part of Spellbound Draft hasn&apos;t been built yet. See the roadmap in{" "}
          <code className="rounded bg-muted px-1 py-0.5">docs/ROADMAP.md</code>.
        </p>
      </div>
    </div>
  );
}
