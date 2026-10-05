"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { markSignedOutHere } from "@/lib/auth/signed-out-here";
import { listLocalDrafts, type LocalDraft } from "@/lib/local-drafts";
import { signOutAction } from "@/modules/auth/ui";

/**
 * Signing out (M9). Unsynced writing on this device stays with this account
 * (it is never deleted by signing out, and no other account can see it),
 * but it isn't in the cloud: so before signing out the author is told, and
 * offered the safe path (stay signed in and let it sync) or to sign out
 * anyway.
 *
 * Signing out works offline too: the session cookie can't be removed by the
 * page, so this browser is marked as signed out at once (nothing more is
 * sent for this account) and the server ends the session on the next
 * request (`/sign-out`, see lib/auth/session-cookie.ts).
 */
export function SignOutButton({ draftOwner }: { draftOwner: string }) {
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [unsynced, setUnsynced] = useState<LocalDraft[]>([]);
  const [open, setOpen] = useState(false);
  const [signedOutOffline, setSignedOutOffline] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) return;
    event.preventDefault();
    const drafts = await listLocalDrafts(draftOwner);
    if (drafts.length === 0) return signOut();
    setUnsynced(drafts);
    setOpen(true);
  }

  function signOut() {
    if (!navigator.onLine) return signOutHere();
    confirmed.current = true;
    form.current?.requestSubmit();
  }

  /** Signed out on this device now; the server finishes on the next request. */
  function signOutHere() {
    markSignedOutHere();
    setOpen(false);
    // A full load, not client navigation: /sign-out is a route handler and the
    // signed-in app must be dropped from memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (navigator.onLine) window.location.assign("/sign-out");
    else setSignedOutOffline(true);
  }

  // Offline sign-out: finish on the server as soon as the connection returns.
  useEffect(() => {
    if (!signedOutOffline) return;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    const finish = () => window.location.assign("/sign-out");
    window.addEventListener("online", finish);
    return () => window.removeEventListener("online", finish);
  }, [signedOutOffline]);

  const many = unsynced.length > 1;
  return (
    <>
      <form ref={form} action={signOutAction} onSubmit={onSubmit}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Some writing isn’t saved to the cloud yet"
          description={
            many
              ? `${unsynced.length} documents have changes saved only on this device.`
              : "One document has changes saved only on this device."
          }
        >
          <div className="space-y-3">
            <ul aria-label="Not yet in the cloud" className="space-y-1 text-sm">
              {unsynced.map((d) => (
                <li key={d.key}>
                  {d.href ? (
                    <Link
                      href={d.href}
                      onClick={() => setOpen(false)}
                      className="text-primary hover:underline"
                    >
                      {d.label || "Untitled"}
                    </Link>
                  ) : (
                    (d.label ?? "Untitled")
                  )}
                  <span className="text-muted-foreground">
                    {" "}
                    · last changed {new Date(d.writtenAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              If you sign out now, this writing stays on this device only. It comes back when you
              sign in here again with this account, but it isn’t on your other devices, and it would
              be lost if this browser’s data were cleared.
            </p>
            <p className="text-sm">
              To save it to the cloud: stay signed in, make sure you’re online, and open{" "}
              {many ? "each one" : "it"}. It saves automatically within a few seconds, and the
              status above the text then says “Saved to the cloud”.
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={signOutHere}>
                Sign out anyway
              </Button>
              <Button autoFocus onClick={() => setOpen(false)}>
                Stay signed in
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {signedOutOffline && <SignedOutHere />}
    </>
  );
}

/**
 * Covers the whole app after an offline sign-out: nothing of the account
 * stays usable on screen, and the author is told where the writing is.
 */
function SignedOutHere() {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = panel.current?.parentElement;
    const others = [...document.body.children].filter((el) => el !== host) as HTMLElement[];
    for (const el of others) el.inert = true;
    panel.current?.focus();
    return () => {
      for (const el of others) el.inert = false;
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signed-out-title"
        tabIndex={-1}
        className="max-w-md space-y-3 focus:outline-none"
      >
        <h1 id="signed-out-title" className="font-serif text-2xl">
          You’re signed out on this device
        </h1>
        <p className="text-sm">
          Your unsynced writing is kept only on this device. It isn’t in the cloud. It comes back
          when you sign in here again with the same account.
        </p>
        <p className="text-sm text-muted-foreground">
          You’re offline, so AuthorOS will finish signing you out as soon as the connection returns.
          Nothing will be uploaded.
        </p>
      </div>
    </div>,
    document.body,
  );
}
