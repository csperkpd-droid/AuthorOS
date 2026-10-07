import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/shell/brand";
import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { getSessionUser } from "@/server/context";

export default async function HomePage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-8 sm:px-6">
      <header>
        <Brand href="/" />
      </header>
      <section className="flex flex-1 flex-col justify-center py-16">
        {/* The public home page is the one marketing surface; the tagline never appears in the app. */}
        <h1 className="font-display text-4xl leading-tight font-medium tracking-tight italic sm:text-5xl">
          {brand.tagline}.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Series, books, scenes, characters, relationships and story structure in one workspace. You
          stay in control of your work.
        </p>
        <div className="mt-8">
          <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
            Sign in
          </Link>
        </div>
      </section>
      <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
        {brand.product} is made by {brand.company}.
      </footer>
    </main>
  );
}
