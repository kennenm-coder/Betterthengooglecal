import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // The commit this build came from, baked into both the page and the
    // /api/version route. When the live server's value differs from the
    // page's, a newer version has been deployed (src/lib/connection-check.ts).
    // Empty on a local build, which switches that check off.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
