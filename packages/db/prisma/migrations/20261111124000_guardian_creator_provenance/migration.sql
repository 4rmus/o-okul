-- Existing guardians deliberately retain NULL: ownership must never be inferred for legacy unlinked records.
ALTER TABLE "Guardian" ADD COLUMN "createdByUserId" TEXT;
