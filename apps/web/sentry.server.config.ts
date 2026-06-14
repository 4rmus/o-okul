import * as Sentry from "@sentry/nextjs";
import { createWebSentryOptions } from "./src/sentry.js";

const sentryOptions = createWebSentryOptions("web-server");
if (sentryOptions) {
  Sentry.init(sentryOptions);
}
