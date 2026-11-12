import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kitty keeps its own agent guidance, so Next must not generate AGENTS.md.
  agentRules: false,
  // A self-contained server for the Docker image (S12, docs/spike/S12.md).
  output: "standalone",
  // S51: no other site may frame Kitty, so an owner can't be tricked into
  // clicking Approve or Close inside a hidden frame.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
