import { describe, expect, it } from "vitest";
import { requireDatabaseConfig } from "./client";

describe("requireDatabaseConfig", () => {
  it("refuses to run without DATABASE_URL and says how to start the local database", () => {
    expect(() => requireDatabaseConfig({})).toThrow("docker compose up -d db");
  });

  it("accepts a configured DATABASE_URL", () => {
    expect(requireDatabaseConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/kitty" })).toMatchObject({
      connectionString: "postgresql://u:p@localhost:5432/kitty",
    });
  });
});
