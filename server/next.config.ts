import type { NextConfig } from "next";

// Route handlers only. cacheComponents is off because every route uses
// `export const dynamic = "force-dynamic"`, which it does not allow.
const nextConfig: NextConfig = {};

export default nextConfig;
