import type { NextConfig } from "next";

// ARGUS backend base URL. Override via ARGUS_BACKEND_URL (server-side, runtime)
// or NEXT_PUBLIC_ARGUS_BACKEND_URL (inlined into the client at build time).
// Defaults to the hosted Render backend so the existing deployment keeps working.
const BACKEND =
  process.env.ARGUS_BACKEND_URL ||
  process.env.NEXT_PUBLIC_ARGUS_BACKEND_URL ||
  "https://argus-xhgx.onrender.com";

const nextConfig: NextConfig = {
  // Standalone output enables running the built app in a plain Node container
  // (see frontend/Dockerfile) for self-hosted deployments.
  output: "standalone",
  async rewrites() {
    return [
      // OAuth 2.1 AS discovery + endpoints — Claude Web calls these directly on the backend.
      // These rewrites let the frontend dev server proxy them too (useful for local testing).
      { source: "/.well-known/:path*",  destination: `${BACKEND}/.well-known/:path*` },
      { source: "/authorize",           destination: `${BACKEND}/authorize` },
      { source: "/register",            destination: `${BACKEND}/register` },
      { source: "/token",               destination: `${BACKEND}/token` },
      // MCP SSE + Bearer endpoints
      { source: "/api/v1/mcp",          destination: `${BACKEND}/api/v1/mcp` },
      { source: "/api/v1/mcp/bearer",   destination: `${BACKEND}/api/v1/mcp/bearer` },
      // Catch-all for any other /api/v1 not handled by a Next.js route file
      { source: "/api/v1/:path*",       destination: `${BACKEND}/api/v1/:path*` },
    ];
  },
};

export default nextConfig;
