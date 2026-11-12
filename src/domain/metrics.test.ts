/** S49: the PRD's delegation follow-through metric, on real Postgres. */
import { describe, expect, it } from "vitest";
import { delegationFollowThrough } from "./metrics";
import { createDemoHousehold } from "./pools";
import { createWorld } from "./testing";

describe("delegation follow-through", () => {
  it("counts households that opened a pool and gave someone the right to spend", async () => {
    const world = await createWorld(); // one household, one active pool with a teen and an agent
    await createDemoHousehold(world.db); // a visitor who never created a pool

    expect(await delegationFollowThrough(world.db)).toEqual({ households: 2, openedPool: 1, delegated: 1, share: 0.5 });
  });

  it("doesn't count a pool whose members were all removed, or one never approved at PayPal", async () => {
    const world = await createWorld();
    await world.db.query("UPDATE pool_members SET active = false WHERE pool_id = $1", [world.pool.id]);
    expect(await delegationFollowThrough(world.db)).toMatchObject({ openedPool: 1, delegated: 0, share: 0 });

    await world.db.query("UPDATE pools SET status = 'awaiting_payer' WHERE id = $1", [world.pool.id]);
    expect(await delegationFollowThrough(world.db)).toMatchObject({ openedPool: 0, delegated: 0 });
  });
});
