import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <Card>
      <CardContent className="space-y-3 text-center">
        <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="font-display text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent you a sign-in link. It expires in 24 hours and works once.
        </p>
        <Link
          href="/sign-in"
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Use a different email
        </Link>
      </CardContent>
    </Card>
  );
}
