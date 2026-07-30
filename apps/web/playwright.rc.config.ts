import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.next.config.js";

export default defineConfig(baseConfig, {
  failOnFlakyTests: true,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  reporter: process.env.CI ? [["line"]] : [["list"]],
  retries: process.env.CI ? 1 : 0,
  use: {
    ...baseConfig.use,
    trace: "retain-on-failure",
  },
});
