import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Cesium's static files (workers, assets, widgets) are copied by postinstall to public/cesium/<version>/,
// so a new Cesium version gets a new URL and the files can be cached forever.
const CESIUM_VERSION: string = JSON.parse(fs.readFileSync(path.join(__dirname, "node_modules/cesium/package.json"), "utf8")).version;

const nextConfig: NextConfig = {
  // The rules/finance/solver engine ships as TypeScript source from ../engine (linked package),
  // so Turbopack's root must cover both web/ and engine/.
  transpilePackages: ["@easescore/engine"],
  turbopack: {
    root: path.join(__dirname, ".."),
    // Cesium's splat decoder breaks the minified 3D chunk in production builds; the site never uses splats.
    resolveAlias: { "@spz-loader/core": "./src/lib/spz-loader-stub.ts" },
  },
  // Map tiles (web/public/tiles, ~1.3 GB, gitignored) are static files or hosted on a bucket in production
  // (NEXT_PUBLIC_TILES_BASE); never trace them into server functions (Vercel caps a function at 250 MB).
  outputFileTracingExcludes: { "/*": ["public/tiles/**/*"], "/**": ["public/tiles/**/*"] },
  // @sparticuz/chromium decompresses its Chromium from bin/*.br at runtime; the tracer cannot see those
  // reads, so ship the folder with the four PDF routes (production PDF was "bin does not exist" without it).
  // Keys are globs: "/api/report/*" stands for /api/report/[parid] (brackets would be a character class).
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/report/*", "/api/planner/memo", "/api/nonprofit/brief", "/api/policy/packet"].map((r) => [r, ["./node_modules/@sparticuz/chromium/bin/**/*"]]),
  ),
  env: { NEXT_PUBLIC_CESIUM_BASE_URL: `/cesium/${CESIUM_VERSION}` },
  async headers() {
    return [{
      source: "/cesium/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
};

export default nextConfig;
