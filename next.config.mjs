/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // server-only packages that must not be bundled
  serverExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
  // Code is checked by TypeScript (runs in every build) and `npm test`; ESLint isn't installed.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
