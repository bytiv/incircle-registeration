import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* The dev-tools badge sits over the phone-sized registration page. Off, so dev looks like production. */
  devIndicators: false,

  /*
   * Photos may come from anywhere: `attendees.photo_path` is "storage path or absolute URL", and
   * every face renders through a plain <img>. next/image only draws the local /brand/* assets; the
   * wildcards keep it from refusing the first remote URL it is handed (from CIB's next.config.ts).
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;
