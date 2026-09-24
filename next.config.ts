import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcrypt"],
  outputFileTracingIncludes: {
    "/*": ["./lib/generated/prisma/**/*"],
  },
};

export default nextConfig;
