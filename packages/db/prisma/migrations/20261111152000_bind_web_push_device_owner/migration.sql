-- Browser subscriptions used to be keyed by user + raw JSON. They cannot be attributed safely on shared browsers.
-- Retain their history, but require explicit opt-in to create a canonical endpoint binding after deployment.
ALTER TABLE "NotificationDeviceToken" ADD COLUMN "webPushEndpointHash" TEXT;
UPDATE "NotificationDeviceToken" SET "disabledAt" = COALESCE("disabledAt", CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
  WHERE "provider" = 'web-push';
DROP INDEX "NotificationDeviceToken_tenantId_userId_token_key";
CREATE UNIQUE INDEX "NotificationDeviceToken_user_provider_token_key"
  ON "NotificationDeviceToken" ("tenantId", "userId", "provider", "token");
CREATE UNIQUE INDEX "NotificationDeviceToken_web_push_endpoint_key"
  ON "NotificationDeviceToken" ("tenantId", "webPushEndpointHash");
