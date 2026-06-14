import * as Sentry from "@sentry/nextjs";
import { createWebSentryOptions } from "./src/sentry.js";

const sentryOptions = createWebSentryOptions("web-client");
if (sentryOptions) {
  Sentry.init(sentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
