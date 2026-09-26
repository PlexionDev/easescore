import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rules/finance/solver engine ships as TypeScript source from ../engine (linked package),
  // so Turbopack's root must cover both web/ and engine/.
  transpilePackages: ["@easescore/engine"],
  turbopack: { root: path.join(__dirname, "..") },
};

export default nextConfig;
