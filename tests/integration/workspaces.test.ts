import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { listPenNames } from "@/modules/pen-names";
import { ensurePersonalWorkspace, findPrimaryMembership } from "@/modules/workspaces";

import { createUser, resetDatabase } from "../support/db";

beforeEach(resetDatabase);

describe("ensurePersonalWorkspace", () => {
  it("creates a workspace, owner membership and default pen name", async () => {
    const user = await createUser("jane@example.com", "Jane Austen");

    const membership = await ensurePersonalWorkspace(user);

    expect(membership.role).toBe("OWNER");
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: membership.workspaceId },
    });
    expect(workspace.name).toBe("Jane Austen's workspace");

    const penNames = await listPenNames({ userId: user.id, ...membership });
    expect(penNames).toEqual([expect.objectContaining({ name: "Jane Austen", isDefault: true })]);
  });

  it("falls back to the email name when the user has no name", async () => {
    const user = await createUser("quill@example.com");
    const membership = await ensurePersonalWorkspace(user);
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: membership.workspaceId },
    });
    expect(workspace.name).toBe("quill's workspace");
  });

  it("is idempotent", async () => {
    const user = await createUser();
    const first = await ensurePersonalWorkspace(user);
    const second = await ensurePersonalWorkspace(user);

    expect(second).toEqual(first);
    expect(await db.workspace.count()).toBe(1);
  });

  it("creates exactly one workspace under concurrent first requests", async () => {
    const user = await createUser();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensurePersonalWorkspace(user)),
    );

    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    expect(await db.workspace.count()).toBe(1);
    expect(await db.penName.count()).toBe(1);
  });

  it("keeps each author's data in their own workspace", async () => {
    const a = await ensurePersonalWorkspace(await createUser());
    const b = await ensurePersonalWorkspace(await createUser());
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });
});

describe("pen name constraints", () => {
  it("allows only one live default pen name per workspace", async () => {
    const user = await createUser();
    const { workspaceId } = await ensurePersonalWorkspace(user);

    await expect(
      db.penName.create({ data: { workspaceId, name: "Second", isDefault: true } }),
    ).rejects.toThrow();

    // Non-default pen names are unrestricted (multiple identities).
    await db.penName.create({ data: { workspaceId, name: "J. A. Mystery" } });
    expect(await db.penName.count({ where: { workspaceId } })).toBe(2);
  });

  it("finds no membership for a user without a workspace", async () => {
    const user = await createUser();
    expect(await findPrimaryMembership(user.id)).toBeNull();
  });
});
