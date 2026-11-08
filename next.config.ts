import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a built-in module; never bundle it.
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Server Actions receive FormData from the studio + admin forms.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
