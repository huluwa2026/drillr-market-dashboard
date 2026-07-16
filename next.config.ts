import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard is a fixed single-screen surface; the dev badge would cover
  // live data and leak into generated preview screenshots.
  devIndicators: false,
};

export default nextConfig;
