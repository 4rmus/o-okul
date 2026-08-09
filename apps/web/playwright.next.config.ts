import { defineConfig } from "@playwright/test";

const measurementMode = process.env.ALMANAC_MEASUREMENT_MODE === "1";
const port = measurementMode ? "43119" : (process.env.NEXT_E2E_PORT ?? "3001");
const baseURL = measurementMode ? `http://localhost:${port}` : (process.env.NEXT_E2E_BASE_URL ?? `http://localhost:${port}`);
const useWebServer = measurementMode || (process.env.NEXT_E2E_SKIP_WEB_SERVER !== "1" && !process.env.NEXT_E2E_BASE_URL);
const webServerCommand = measurementMode
  ? "pnpm --filter @o-okul/shared-types build && pnpm --filter @o-okul/ui build && pnpm next:build && exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 43119"
  : "pnpm --filter @o-okul/shared-types build && pnpm --filter @o-okul/ui build && if [ ! -f .next/BUILD_ID ]; then pnpm next:build; fi && exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${NEXT_E2E_PORT:-3001}";

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
          command: webServerCommand,
          env: {
            ...process.env,
            NEXT_E2E_PORT: port,
          },
          reuseExistingServer: measurementMode ? false : !process.env.CI && !process.env.NEXT_E2E_PORT,
          timeout: 120_000,
          url: `${baseURL}/login`,
        },
      }
    : {}),
});
