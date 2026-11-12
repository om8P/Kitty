import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld } from "@/domain/testing";

const getContainer = vi.hoisted(() => vi.fn());
vi.mock("@/server/container", () => ({ getContainer }));

import { POST } from "./route";

// A made-up secret for the test only.
const SECRET = "test-cron-secret";

function post(authorization?: string) {
  return new Request("http://localhost/api/internal/tick", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/internal/tick", () => {
  beforeEach(async () => {
    const world = await createWorld();
    getContainer.mockReset();
    getContainer.mockResolvedValue({ db: world.db, purchases: world.deps });
    vi.stubEnv("CRON_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is off when no CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(post(`Bearer ${SECRET}`))).status).toBe(503);
    expect(getContainer).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong-secret", `Basic ${SECRET}`, "Bearer ", SECRET])("refuses %s", async (header) => {
    expect((await POST(post(header))).status).toBe(401);
    expect(getContainer).not.toHaveBeenCalled();
  });

  it("runs every job with the right secret", async () => {
    const response = await POST(post(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobs: { replayedCaptures: 0, expiredApprovals: 0 }, failed: [] });
  });
});
