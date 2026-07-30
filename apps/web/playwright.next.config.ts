import { defineConfig } from "@playwright/test";

const port = process.env.NEXT_E2E_PORT ?? "3001";
const baseURL = process.env.NEXT_E2E_BASE_URL ?? `http://localhost:${port}`;
const useWebServer = process.env.NEXT_E2E_SKIP_WEB_SERVER !== "1" && !process.env.NEXT_E2E_BASE_URL;

export default defineConfig({
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e-next",
  snapshotPathTemplate: `{testDir}/__screenshots__/{testFilePath}/{arg}-${process.platform}{ext}`,
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.NEXT_E2E_IGNORE_HTTPS_ERRORS === "1",
  },
  ...(useWebServer
    ? {
        webServer: {
          command: "rm -rf .next && pnpm --filter @o-okul/shared-types build && pnpm --filter @o-okul/ui build && exec node node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port ${NEXT_E2E_PORT:-3001}",
          env: {
            ...process.env,
            NEXT_E2E_PORT: port,
          },
          reuseExistingServer: !process.env.CI && !process.env.NEXT_E2E_PORT,
          timeout: 120_000,
          url: `${baseURL}/login`,
        },
      }
    : {}),
});
