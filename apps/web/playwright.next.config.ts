import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-next",
  use: {
    baseURL: "http://localhost:3001",
  },
  webServer: {
    command: "pnpm --filter @uzman-hocam/ui build && pnpm --filter @uzman-hocam/web next:dev",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://localhost:3001",
  },
});
