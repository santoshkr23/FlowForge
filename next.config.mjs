/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite", "bullmq", "ioredis", "nodemailer"],
  },
};

export default nextConfig;
