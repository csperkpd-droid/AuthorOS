import { readFile } from "node:fs/promises";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), ".dev-mail", "outbox.jsonl");

/** Polls the dev mail outbox for the newest sign-in link sent to `email`. */
export async function waitForMagicLink(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await readFile(OUTBOX, "utf8").catch(() => "");
    const match = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { to: string; url: string })
      .findLast((m) => m.to === email);
    if (match) return match.url;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No sign-in email for ${email} within ${timeoutMs}ms`);
}

export function uniqueEmail() {
  return `e2e-${crypto.randomUUID()}@example.com`;
}
