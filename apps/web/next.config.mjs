import { withSentryConfig } from "@sentry/nextjs";

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@o-okul/ui", "@o-okul/shared-types"],
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const apiUrl = process.env.API_URL ?? "http://localhost:3100";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/health", destination: `${apiUrl}/health` },
      { source: "/health/ready", destination: `${apiUrl}/health/ready` },
      { source: "/metrics", destination: `${apiUrl}/metrics` },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
