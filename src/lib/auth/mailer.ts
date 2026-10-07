import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

type MagicLinkEmail = { to: string; url: string };

export const DEV_MAIL_DIR = path.join(process.cwd(), ".dev-mail");
export const DEV_MAIL_OUTBOX = path.join(DEV_MAIL_DIR, "outbox.jsonl");

export async function sendMagicLink(email: MagicLinkEmail): Promise<void> {
  if (env.EMAIL_TRANSPORT === "outbox") return writeToOutbox(email);
  return sendWithResend(email);
}

async function writeToOutbox({ to, url }: MagicLinkEmail) {
  if (process.env.VERCEL) {
    throw new Error("The dev mail outbox is disabled on Vercel. Set AUTH_RESEND_KEY.");
  }
  await mkdir(DEV_MAIL_DIR, { recursive: true });
  await appendFile(DEV_MAIL_OUTBOX, JSON.stringify({ to, url, sentAt: new Date() }) + "\n");
  console.info(`\n[dev mail] Sign-in link for ${to}:\n${url}\n`);
}

async function sendWithResend({ to, url }: MagicLinkEmail) {
  if (!env.AUTH_RESEND_KEY) throw new Error("AUTH_RESEND_KEY is not set.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTH_RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      ...magicLinkContent(url),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
}

/** The sign-in email's subject and bodies. */
export function magicLinkContent(url: string) {
  return {
    subject: "Your Spellbound Draft sign-in link",
    html: magicLinkHtml(url),
    text: `Sign in to Spellbound Draft:\n${url}\n\nIf you did not request this email you can safely ignore it.\n\nSpellbound Draft · Scrollkeep Studio`,
  };
}

function magicLinkHtml(url: string) {
  const safeUrl = url.replace(/"/g, "&quot;");
  return `<!doctype html>
<html><body style="margin:0;background:#f7f1e5;font-family:Arial,Helvetica,sans-serif;color:#231b2e">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
    <table width="100%" style="max-width:480px;background:#fffdf8;border:1px solid #d8ccb4;border-radius:10px">
      <tr><td style="padding:32px">
        <p style="font-family:'Cormorant Garamond',Garamond,Georgia,serif;font-size:24px;margin:0 0 16px;color:#231b2e"><strong>Spellbound</strong> <em style="font-weight:500">Draft</em></p>
        <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Click below to sign in. This link expires in 24 hours and can be used once.</p>
        <a href="${safeUrl}" style="display:inline-block;background:#5a2e6e;color:#f7f1e5;text-decoration:none;padding:12px 20px;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600">Sign in to Spellbound Draft</a>
        <p style="font-size:13px;color:#5e5468;line-height:1.5;margin:24px 0 0">If you did not request this email you can safely ignore it.</p>
        <p style="font-size:12px;color:#5e5468;line-height:1.5;margin:24px 0 0;border-top:1px solid #d8ccb4;padding-top:16px">Spellbound Draft · Scrollkeep Studio</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
