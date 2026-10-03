import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensurePersonalWorkspace } from "@/modules/workspaces";

import { sendMagicLink } from "./mailer";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Database sessions: revocable server-side, and the session table is the
  // source of truth when collaboration and device management arrive.
  session: { strategy: "database" },
  providers: [
    Resend({
      // A transport-neutral id keeps callback URLs stable if the email
      // service ever changes.
      id: "email",
      name: "Email",
      apiKey: env.AUTH_RESEND_KEY,
      from: env.EMAIL_FROM,
      sendVerificationRequest: ({ identifier, url }) => sendMagicLink({ to: identifier, url }),
    }),
    ...(env.isGoogleEnabled
      ? [
          Google({
            // Google only returns verified emails, and magic links prove
            // ownership of the address, so linking by email is safe here.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    error: "/sign-in",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // Every author gets a personal workspace and a default pen name at
    // sign-up. The DAL calls the same idempotent function as a safety net.
    async createUser({ user }) {
      if (user.id && user.email) {
        await ensurePersonalWorkspace({ id: user.id, name: user.name, email: user.email });
      }
    },
  },
});

export const isGoogleEnabled = env.isGoogleEnabled;
