import { withSentryConfig } from "@sentry/nextjs";

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@o-okul/ui", "@o-okul/shared-types"],
  async redirects() {
    // DEC-20260930-02: platform sağlık yüzeyleri control-plane'e taşındı.
    const retiredPlatformHealth = ["/kurum/sistem-sagligi", "/kurum/gozlemlenebilirlik"].map((source) => ({
      source,
      destination: "/kurum/operasyon-ve-kanit",
      permanent: false,
    }));
    // Berrak §4: tek sınav optik/rapor işi sınav çalışma alanındadır; eski ?examId= bağlantıları yönlenir.
    const examId = { type: "query", key: "examId", value: "(?<examId>[A-Za-z0-9_-]+)" };
    const workspaceRedirect = (source, tab, segment) => ({
      source,
      has: tab ? [examId, { type: "query", key: "tab", value: tab }] : [examId],
      destination: `/kurum/sinavlar/:examId/${segment}`,
      permanent: false,
    });
    return [
      ...retiredPlatformHealth,
      workspaceRedirect("/kurum/optik", "upload", "optik/yukleme"),
      workspaceRedirect("/kurum/optik", "quarantine", "optik/eslesmeyenler"),
      workspaceRedirect("/kurum/optik", undefined, "optik/duzen"),
      workspaceRedirect("/kurum/raporlar", "students", "rapor/ogrenciler"),
      workspaceRedirect("/kurum/raporlar", "karne", "rapor/karne"),
      workspaceRedirect("/kurum/raporlar", "exports", "rapor/ciktilar"),
      workspaceRedirect("/kurum/raporlar", undefined, "rapor/genel"),
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const apiUrl = process.env.API_URL ?? "http://localhost:3100";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/health", destination: `${apiUrl}/health` },
      { source: "/health/ready", destination: `${apiUrl}/health/ready` },
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
