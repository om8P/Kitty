import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kitty keeps its own agent guidance, so Next must not generate AGENTS.md.
  agentRules: false,
  // A self-contained server for the Docker image (S12, docs/spike/S12.md).
  output: "standalone",
};

export default nextConfig;
