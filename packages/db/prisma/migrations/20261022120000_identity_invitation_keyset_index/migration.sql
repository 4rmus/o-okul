-- Keyset order of GET /identity-invitations (tenant, createdAt, id; both directions). Without it the list sorts every
-- tenant invitation per page. Plain CREATE INDEX as in the other index migrations: SHARE lock on "IdentityInvitation"
-- for the build (reads continue, writes wait).
CREATE INDEX "IdentityInvitation_tenantId_createdAt_id_idx"
  ON "IdentityInvitation" ("tenantId", "createdAt", "id");
