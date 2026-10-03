import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Characters" };

export default async function Page() {
  await requireAuthorContext();
  return <ComingSoon href="/characters" />;
}
