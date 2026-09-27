import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rules/finance/solver engine ships as TypeScript source from ../engine (linked package),
  // so Turbopack's root must cover both web/ and engine/.
  transpilePackages: ["@easescore/engine"],
  turbopack: {
    root: path.join(__dirname, ".."),
    // Cesium's splat decoder breaks the minified 3D chunk in production builds; the site never uses splats.
    resolveAlias: { "@spz-loader/core": "./src/lib/spz-loader-stub.ts" },
  },
};

export default nextConfig;
