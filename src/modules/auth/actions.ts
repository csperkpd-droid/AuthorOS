"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";

export type SignInState = { error?: string; email?: string };

const emailSchema = z.email("Enter a valid email address.");

export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = String(formData.get("email") ?? "").trim();
  const parsed = emailSchema.safeParse(raw.toLowerCase());
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: raw };

  try {
    // redirect: false so we navigate to our own page directly, instead of
    // via /api/auth/verify-request (which leaves the API URL in the address bar).
    await signIn("email", {
      email: parsed.data,
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "We couldn't send your sign-in link. Please try again.", email: raw };
    }
    throw error;
  }
  redirect("/sign-in/check-email");
}

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: safeCallbackUrl(formData.get("callbackUrl")) });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}
