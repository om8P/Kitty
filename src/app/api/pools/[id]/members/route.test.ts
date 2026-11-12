import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoHousehold } from "@/domain/pools";
import { createWorld, type World } from "@/domain/testing";
import type { UserRow } from "@/domain/types";
import { DomainError } from "@/domain/types";

const requireSession = vi.hoisted(() => vi.fn());
const getContainer = vi.hoisted(() => vi.fn());
vi.mock("@/server/session", () => ({ requireSession }));
vi.mock("@/server/container", () => ({ getContainer }));

import { POST as add } from "./route";
import { POST as edit } from "./[memberId]/route";
import { POST as remove } from "./[memberId]/remove/route";

function post(body: unknown = {}) {
  return new Request("http://localhost/api/pools/x/members", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

function signIn(world: World, user: UserRow, householdId = world.householdId) {
  requireSession.mockResolvedValue({ householdId, user, users: [world.owner, world.teenUser] });
}

const params = (world: World, memberId?: string) => ({ params: Promise.resolve({ id: world.pool.id, memberId: memberId ?? "" }) });

describe("member routes", () => {
  let world: World;
  beforeEach(async () => {
    world = await createWorld();
    getContainer.mockResolvedValue({ db: world.db });
    requireSession.mockReset();
  });

  it("let the owner change a member's rules", async () => {
    signIn(world, world.owner);
    const response = await edit(post({ limit: "25", threshold: "0", stores: ["Gadget Hub"] }), params(world, world.teen.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      member: { id: world.teen.id, limitCents: 25_00, approvalThresholdCents: 0, allowedStores: ["Gadget Hub"], active: true },
    });
  });

  it("refuse the family member, with the owner's message", async () => {
    signIn(world, world.teenUser);
    const response = await remove(post(), params(world, world.agent.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only the pool owner can change who can spend." });
  });

  it("don't reveal another household's pool", async () => {
    const other = await createDemoHousehold(world.db);
    signIn(world, other.owner, other.householdId);
    const response = await edit(post({ limit: "25", threshold: "0", stores: ["Gadget Hub"] }), params(world, world.teen.id));
    expect(response.status).toBe(404);
  });

  it("explain a bad dollar amount", async () => {
    signIn(world, world.owner);
    const response = await edit(post({ limit: "lots", threshold: "0", stores: ["Gadget Hub"] }), params(world, world.teen.id));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Enter the limit in dollars, for example 40." });
  });

  it("remove a member, then add them back as the household's own family member", async () => {
    signIn(world, world.owner);
    const removed = await remove(post(), params(world, world.teen.id));
    expect(await removed.json()).toMatchObject({ member: { id: world.teen.id, active: false } });

    const added = await add(post({ kind: "person", limit: "30", threshold: "10", stores: ["Fresh Market"] }), params(world));
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ member: { id: world.teen.id, userId: world.teenUser.id, active: true, limitCents: 30_00 } });
  });

  it("need a session", async () => {
    requireSession.mockRejectedValue(new DomainError("forbidden", "Start the demo to continue."));
    const response = await remove(post(), params(world, world.teen.id));
    expect(response.status).toBe(403);
  });
});
