import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const pingDatabase = vi.hoisted(() => vi.fn());
const databaseTls = vi.hoisted(() => vi.fn());
vi.mock("@/db/ping", () => ({ pingDatabase }));
vi.mock("@/db/connection", () => ({ databaseTls }));

import { GET } from "./route";

const healthBody = z.strictObject({
  status: z.literal("ok"),
  db: z.enum(["ok", "error", "unconfigured"]),
  dbTls: z.enum(["verified", "off"]),
  uptimeSeconds: z.number().int().nonnegative(),
});

describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pingDatabase.mockReset();
    databaseTls.mockReset();
  });

  it.each(["ok", "error", "unconfigured"] as const)(
    "stays up and reports db=%s",
    async (db) => {
      pingDatabase.mockResolvedValue(db);
      databaseTls.mockReturnValue("verified");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      const response = await GET();
      const body = healthBody.parse(await response.json());

      expect(response.status).toBe(200);
      expect(body.db).toBe(db);
      expect(body.dbTls).toBe("verified");
      expect(log).toHaveBeenCalledWith(`health ok db=${db} tls=${"verified"}`);
    },
  );
});
