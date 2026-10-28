/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
  },
};

export default nextConfig;
