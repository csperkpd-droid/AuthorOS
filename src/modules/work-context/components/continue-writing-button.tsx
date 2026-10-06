"use client";

import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requestRestore, type PlaceAnchor } from "@/lib/work-place";

/**
 * Continue Writing (M10): straight back into the manuscript at the latest
 * writing place, on any device. The position is restored when it can still
 * be found; scroll is not carried across devices.
 */
export function ContinueWritingButton({
  owner,
  sceneId,
  href,
  anchor,
}: {
  owner: string;
  sceneId: string;
  href: string;
  anchor: PlaceAnchor | null;
}) {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        requestRestore(owner, sceneId, anchor ? { ...anchor, scrollY: -1 } : null);
        router.push(href);
      }}
    >
      <PenLine aria-hidden />
      Continue writing
    </Button>
  );
}
