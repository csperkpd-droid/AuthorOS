import { SIGNED_OUT_COOKIE, SIGNED_OUT_MAX_AGE } from "./session-cookie";

/**
 * Browser side of "Sign out anyway" (M9): signing out must work offline,
 * so the page marks this browser as signed out at once; the server finishes
 * the job (ends the session) on the very next request. See session-cookie.ts.
 */
export function markSignedOutHere() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SIGNED_OUT_COOKIE}=1; Path=/; Max-Age=${SIGNED_OUT_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Whether the author signed out on this device (nothing may be sent for them any more). */
export function isSignedOutHere() {
  return (
    typeof document !== "undefined" &&
    document.cookie.split("; ").some((c) => c.startsWith(`${SIGNED_OUT_COOKIE}=`))
  );
}
