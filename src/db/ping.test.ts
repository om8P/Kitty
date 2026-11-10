import { describe, expect, it } from "vitest";
import { pingDatabase } from "./ping";

describe("pingDatabase", () => {
  it("reports unconfigured when no URL is set", async () => {
    expect(await pingDatabase("")).toBe("unconfigured");
  });

  it("reports error, without throwing, when the database can't be reached", async () => {
    // Port 1 on localhost refuses connections at once.
    expect(await pingDatabase("postgresql://x:x@127.0.0.1:1/x")).toBe("error");
  });
});
