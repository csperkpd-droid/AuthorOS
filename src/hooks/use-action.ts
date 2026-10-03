"use client";

import { useCallback, useState, useTransition } from "react";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/**
 * Calls a Server Action from an event handler with pending and error state.
 * Returns the result so callers can react (close a dialog, navigate…).
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<Result<T>>,
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (...args: Args) =>
      new Promise<Result<T>>((resolve) => {
        setError(null);
        startTransition(async () => {
          const result = await action(...args);
          if (!result.ok) setError(result.error);
          resolve(result);
        });
      }),
    [action],
  );

  return { run, pending, error, setError };
}
