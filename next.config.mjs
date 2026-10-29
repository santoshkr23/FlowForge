/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // server-only packages that must not be bundled
  serverExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
};

export default nextConfig;
