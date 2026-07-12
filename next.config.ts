import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
