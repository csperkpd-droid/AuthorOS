// Auth.js database-session cookie names. The proxy only checks that one is
// present (an optimistic check); the real validation happens in the DAL.
export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;

/**
 * "Signed out on this device" (M9). Set by the page itself when the author
 * chooses Sign out anyway, which works offline (the session cookie is
 * httpOnly, so a page can't remove it). Every later request sees it first:
 * the proxy sends it to `/sign-out`, which ends the session on the server and
 * clears this cookie, and the session lookup treats it as signed out. It can
 * only ever remove access, never grant it.
 */
export const SIGNED_OUT_COOKIE = "authoros-signed-out";

/** As long as a session can live (Auth.js default: 30 days). */
export const SIGNED_OUT_MAX_AGE = 30 * 24 * 60 * 60;
