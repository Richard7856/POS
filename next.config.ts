import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fix Turbopack workspace root — needed because the project is inside iCloud Drive,
  // which has multiple package-lock.json files at different directory levels
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
