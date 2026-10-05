import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAMES, SIGNED_OUT_COOKIE } from "@/lib/auth/session-cookie";

const PUBLIC_PATHS = ["/", "/sign-in", "/sign-out"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")));
}

/**
 * Optimistic auth check: redirect visitors without a session cookie to
 * sign-in. It never touches the database; real validation happens in the
 * Data Access Layer (src/server/context.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // The author signed out on this device (possibly offline): finish signing
  // out before anything else is served or any action runs.
  if (request.cookies.has(SIGNED_OUT_COOKIE) && pathname !== "/sign-out") {
    return NextResponse.redirect(new URL("/sign-out", request.url));
  }
  if (isPublic(pathname)) return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Skip API routes, Next.js internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
