import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("./migrations/20260829120000_enforce_active_class_name_uniqueness/migration.sql", import.meta.url),
  "utf8",
);

describe("active class name uniqueness migration", () => {
  it("blocks existing duplicates without rewriting data and allows deleted-name reuse", () => {
    expect(migration).toContain("CLASS_ACTIVE_NAME_DUPLICATES_BLOCK_MIGRATION");
    expect(migration).toContain("set_config('app.bypass_rls', 'true', true)");
    expect(migration).toContain('CREATE UNIQUE INDEX "Class_tenantId_active_name_key"');
    expect(migration).toContain('WHERE "deletedAt" IS NULL');
    expect(migration).toContain('lower(input_name COLLATE "tr-x-icu")');
    expect(migration).toContain("'[[:space:]]+', '', 'g'");
    expect(migration).not.toMatch(/\b(?:DELETE|UPDATE)\s+"Class"\b/i);
  });
});
