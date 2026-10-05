import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth";
import { SIGNED_OUT_COOKIE } from "@/lib/auth/session-cookie";

/**
 * Finishes a sign-out the author started on this device (M9), possibly while
 * offline: ends the session on the server, clears the "signed out here"
 * mark and goes to sign-in. Only acts when that mark is present, so a link
 * to this address can't sign anyone out.
 */
export async function GET() {
  const jar = await cookies();
  if (!jar.has(SIGNED_OUT_COOKIE)) redirect("/sign-in");
  jar.delete(SIGNED_OUT_COOKIE);
  await signOut({ redirectTo: "/sign-in" });
}
