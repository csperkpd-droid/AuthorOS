import "server-only";

import { z } from "zod";

// Server configuration for auth and email. DATABASE_URL is read by
// `lib/db.ts` directly so database code can run outside Next.js (tests, scripts).
const schema = z.object({
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (run `npx auth secret`)"),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_RESEND_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("AuthorOS <onboarding@resend.dev>"),
  // "resend" sends real email. "outbox" writes sign-in links to .dev-mail/
  // for local development and end-to-end tests. Defaults to resend when a
  // Resend key is present, otherwise outbox.
  EMAIL_TRANSPORT: z.enum(["resend", "outbox"]).optional(),
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  EMAIL_TRANSPORT: parsed.EMAIL_TRANSPORT ?? (parsed.AUTH_RESEND_KEY ? "resend" : "outbox"),
  isGoogleEnabled: Boolean(parsed.AUTH_GOOGLE_ID && parsed.AUTH_GOOGLE_SECRET),
};
