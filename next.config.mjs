/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // server-only packages that must not be bundled
  serverExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
  // Code is checked by TypeScript (runs in every build) and `npm test`; ESLint isn't installed.
  eslint: { ignoreDuringBuilds: true },
  // keep build memory low enough for small hosting plans (e.g. Render free, 512 MB)
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  // Docker / VPS: a small self-contained server in .next/standalone
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // OAuth discovery for the MCP connector (Claude, ChatGPT…) lives at the site root
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp-oauth/metadata/resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/mcp-oauth/metadata/resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/mcp-oauth/metadata/server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/mcp-oauth/metadata/server" },
      { source: "/.well-known/openid-configuration", destination: "/api/mcp-oauth/metadata/server" },
    ];
  },
};

export default nextConfig;
