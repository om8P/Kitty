import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GET } from "./route";

const healthBody = z.strictObject({ status: z.literal("ok") });

describe("GET /api/health", () => {
  it("reports that the app is up", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(healthBody.safeParse(await response.json()).success).toBe(true);
  });
});
