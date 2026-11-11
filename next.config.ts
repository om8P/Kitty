import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kitty keeps its own agent guidance, so Next must not generate AGENTS.md.
  agentRules: false,
  // A self-contained server for the Docker image (S12, docs/spike/S12.md).
  output: "standalone",
  // PGlite loads its WebAssembly files from disk, which breaks if they are bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
