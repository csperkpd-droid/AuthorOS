import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/shell/brand";
import { buttonVariants } from "@/components/ui/button";
import { getSessionUser } from "@/server/context";

export default async function HomePage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-8 sm:px-6">
      <header>
        <Brand href="/" />
      </header>
      <section className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Every part of your story, connected.
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
    </main>
  );
}
