"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { listLocalDrafts, type LocalDraft } from "@/lib/local-drafts";
import { signOutAction } from "@/modules/auth/ui";

/**
 * Signing out (M9). Unsynced writing on this device stays with this account
 * (it is never deleted by signing out, and no other account can see it),
 * but it isn't in the cloud: so before signing out the author is told, and
 * offered the safe path (stay signed in and let it sync) or to sign out
 * anyway.
 */
export function SignOutButton({ draftOwner }: { draftOwner: string }) {
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [unsynced, setUnsynced] = useState<LocalDraft[]>([]);
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) return;
    event.preventDefault();
    const drafts = await listLocalDrafts(draftOwner);
    if (drafts.length === 0) return signOut();
    setUnsynced(drafts);
    setOpen(true);
  }

  function signOut() {
    confirmed.current = true;
    form.current?.requestSubmit();
  }

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
              <Button variant="outline" onClick={signOut}>
                Sign out anyway
              </Button>
              <Button autoFocus onClick={() => setOpen(false)}>
                Stay signed in
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
