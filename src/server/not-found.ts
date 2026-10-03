import "server-only";

import { notFound } from "next/navigation";

import { NotFoundError } from "@/lib/errors";

/** Awaits a service call, rendering the 404 page if the thing doesn't exist (or isn't the author's). */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
