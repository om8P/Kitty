import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const pingDatabase = vi.hoisted(() => vi.fn());
vi.mock("@/db/ping", () => ({ pingDatabase }));

import { GET } from "./route";

const healthBody = z.strictObject({
  status: z.literal("ok"),
  db: z.enum(["ok", "error", "unconfigured"]),
  uptimeSeconds: z.number().int().nonnegative(),
});

describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pingDatabase.mockReset();
  });

  it.each(["ok", "error", "unconfigured"] as const)(
    "stays up and reports db=%s",
    async (db) => {
      pingDatabase.mockResolvedValue(db);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      const response = await GET();
      const body = healthBody.parse(await response.json());

      expect(response.status).toBe(200);
      expect(body.db).toBe(db);
      expect(log).toHaveBeenCalledWith(`health ok db=${db}`);
    },
  );
});
