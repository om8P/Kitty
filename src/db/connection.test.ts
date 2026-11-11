import { describe, expect, it } from "vitest";
import { databaseTls, pgConfig } from "./connection";

const url = "postgresql://u:p@db.example.test:5432/kitty";
const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";

describe("pgConfig", () => {
  it("returns null with no DATABASE_URL", () => {
    expect(pgConfig({})).toBeNull();
    expect(pgConfig({ DATABASE_URL: "" })).toBeNull();
  });

  it("uses plain connections when no CA is set", () => {
    expect(pgConfig({ DATABASE_URL: url })).toEqual({ connectionString: url });
    expect(databaseTls({ DATABASE_URL: url })).toBe("off");
  });

  it("verifies the server certificate when a CA is set", () => {
    const config = pgConfig({ DATABASE_URL: url, DATABASE_CA_CERT: pem });
    expect(config?.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(databaseTls({ DATABASE_CA_CERT: pem })).toBe("verified");
  });

  it("turns literal \\n sequences into newlines", () => {
    const escaped = pem.replace(/\n/g, "\\n");
    const config = pgConfig({ DATABASE_URL: url, DATABASE_CA_CERT: escaped });
    expect(config?.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
  });

  it("treats a blank CA as unset", () => {
    expect(databaseTls({ DATABASE_CA_CERT: "  " })).toBe("off");
  });
});
