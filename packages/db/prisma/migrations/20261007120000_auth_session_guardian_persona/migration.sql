-- KV-3b (DEC-20261003-01, product owner decision 2026-10-05): a staff/teacher account that is also a
-- guardian keeps one account; the GUARDIAN role is added as a separate membership and opened as its own
-- session persona. Only the persona allow-list widens; existing rows already satisfy the new check.
ALTER TABLE "AuthSession"
  DROP CONSTRAINT "AuthSession_activePersona_check",
  ADD CONSTRAINT "AuthSession_activePersona_check"
  CHECK ("activePersona" IS NULL OR "activePersona" IN ('STAFF', 'TEACHER', 'STUDENT', 'GUARDIAN'));
