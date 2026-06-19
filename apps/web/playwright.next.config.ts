import { defineConfig } from "@playwright/test";

const port = process.env.NEXT_E2E_PORT ?? "3001";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e-next",
  use: {
    baseURL,
  },
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
});
