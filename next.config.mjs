/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // server-only packages that must not be bundled
  serverExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
  // Code is checked by TypeScript (runs in every build) and `npm test`; ESLint isn't installed.
  eslint: { ignoreDuringBuilds: true },
  // keep build memory low enough for small hosting plans (e.g. Render free, 512 MB)
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
};

export default nextConfig;
