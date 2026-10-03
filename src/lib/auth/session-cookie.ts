// Auth.js database-session cookie names. The proxy only checks that one is
// present (an optimistic check); the real validation happens in the DAL.
export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;
