export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * Only allow same-origin relative paths as post-sign-in destinations,
 * so a crafted `?callbackUrl=` cannot redirect to another site.
 */
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return DEFAULT_SIGNED_IN_PATH;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  if (value.startsWith("/sign-in") || value.startsWith("/api/auth")) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  return value;
}
