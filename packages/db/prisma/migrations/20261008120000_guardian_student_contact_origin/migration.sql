-- KV-3c (DEC-20261003-01, product owner decision 2026-10-05): unlinking a StudentContact from its guardian removes
-- only the GuardianStudent access link that the contact link flow itself created. A link that already existed
-- (created through the guardian API or the bulk invite, possibly with permissions turned on) keeps its row and
-- permissions. Additive: existing rows default to false, i.e. they count as pre-existing and are never removed by
-- an unlink.
-- RLS: GuardianStudent already carries tenant isolation, reset and device-restore boundary policies; a new
-- non-key boolean column needs no policy, grant or composite FK change.
ALTER TABLE "GuardianStudent" ADD COLUMN "createdByStudentContact" BOOLEAN NOT NULL DEFAULT false;
