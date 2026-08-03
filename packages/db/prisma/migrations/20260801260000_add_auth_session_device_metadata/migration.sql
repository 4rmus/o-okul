ALTER TABLE "AuthSession"
  ADD COLUMN "deviceLabel" TEXT,
  ADD COLUMN "clientIpPrefix" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

UPDATE "AuthSession"
SET "lastSeenAt" = "updatedAt";
