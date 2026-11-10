import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kitty keeps its own agent guidance, so Next must not generate AGENTS.md.
  agentRules: false,
};

export default nextConfig;
