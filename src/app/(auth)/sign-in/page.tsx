import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isGoogleEnabled } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { SignInForm } from "@/modules/auth/ui";
import { getSessionUser } from "@/server/context";

export const metadata: Metadata = { title: "Sign in" };

// Auth.js error codes that can reach this page via `?error=`.
const ERROR_MESSAGES: Record<string, string> = {
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  OAuthAccountNotLinked: "This email is already linked to another sign-in method.",
  AccessDenied: "Access was denied.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  if (await getSessionUser()) redirect(callbackUrl);

  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const error =
    errorCode && (ERROR_MESSAGES[errorCode] ?? "Something went wrong. Please try again.");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>New here? Signing in creates your workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <SignInForm callbackUrl={callbackUrl} googleEnabled={isGoogleEnabled} />
      </CardContent>
    </Card>
  );
}
