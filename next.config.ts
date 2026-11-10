import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only "N" button; bottom-left covered the sidebar's account button.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
