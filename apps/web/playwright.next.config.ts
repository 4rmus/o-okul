import { defineConfig } from "@playwright/test";

const port = process.env.NEXT_E2E_PORT ?? "3001";
const baseURL = process.env.NEXT_E2E_BASE_URL ?? `http://localhost:${port}`;
const useWebServer = process.env.NEXT_E2E_SKIP_WEB_SERVER !== "1" && !process.env.NEXT_E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e-next",
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.NEXT_E2E_IGNORE_HTTPS_ERRORS === "1",
  },
  ...(useWebServer
    ? {
        webServer: {
          command: "pnpm --filter @uzman-hocam/shared-types build && pnpm --filter @uzman-hocam/ui build && pnpm --filter @uzman-hocam/web next:dev",
          env: {
            ...process.env,
            NEXT_E2E_PORT: port,
          },
          reuseExistingServer: !process.env.CI && !process.env.NEXT_E2E_PORT,
          timeout: 120_000,
          url: baseURL,
        },
      }
    : {}),
});
