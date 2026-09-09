import type { Queryable } from "@o-okul/db";
import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";
import type { DeviceBackupPayload } from "./device-backup.service.js";

type Impact = NonNullable<TenantDeviceBackupPreview["impact"]>;
export type DeviceRestoreForeignKey = { table: string; references: string; targetSchema: string; columns: string[]; targetColumns: string[]; match: string; validated: boolean };
export async function readDeviceRestoreForeignKeys(db: Queryable): Promise<DeviceRestoreForeignKey[]> {
  return (await db.query<DeviceRestoreForeignKey>(`SELECT src.relname::text AS "table",dst.relname::text AS "references",ns.nspname::text AS "targetSchema",
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS "targetColumns",
    c.confmatchtype::text AS match,c.convalidated AS validated
    FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_class dst ON dst.oid=c.confrelid JOIN pg_namespace ns ON ns.oid=dst.relnamespace
    WHERE c.contype='f' AND src.relnamespace='public'::regnamespace AND NOT src.relispartition ORDER BY src.relname,c.conname`)).rows;
}

/** Relation counts only; a complete FK check is not a complete domain/authorization check. */
export function deviceRestoreReferences(archive: DeviceBackupPayload, current: DeviceBackupPayload, policies: Impact["tables"], keys: readonly DeviceRestoreForeignKey[]): NonNullable<Impact["references"]> {
  const proposed = new Map(Object.entries(policies).map(([table, policy]) => [table, (policy.policy === "PRESERVE" ? current : archive).tables[table]!.map(e => JSON.parse(e.row) as Record<string,unknown>)]));
  const conflicts = new Map<string,{ table: string; references: string; links: number }>(), unverified = new Set<string>();
  let checkedLinks = 0;
  if (!keys.length) unverified.add("CATALOG_EMPTY");
  const tuple = (row: Record<string,unknown>, fields: string[]) => {
    if (fields.some(f => !Object.hasOwn(row,f))) return undefined;
    const values=fields.map(f=>row[f]);
    // Numeric keys need lossless SQL comparison; JSON parsing can round even into a safe integer.
    if (values.some(v=>v != null && typeof v !== "string" && typeof v !== "boolean")) return undefined;
    return values;
  };
  for (const fk of keys) {
    if (policies[fk.table]?.policy !== "REPLACE" && policies[fk.references]?.policy !== "REPLACE") continue;
    const name = `${fk.table} → ${fk.references}`, source = proposed.get(fk.table), target = proposed.get(fk.references);
    if (!source || !fk.validated || fk.targetSchema !== "public" || !["s","f"].includes(fk.match) || !fk.columns.length || fk.columns.length !== fk.targetColumns.length) { unverified.add(name); continue; }
    if (!source.length) continue;
    if (!target) { unverified.add(name); continue; }
    const index = new Set<string>(); let targetComplete = true;
    for (const row of target) { const value = tuple(row,fk.targetColumns); if (value === undefined) targetComplete = false; else index.add(JSON.stringify(value)); }
    if (!targetComplete) { unverified.add(name); continue; }
    let broken = 0;
    for (const row of source) {
      const value = tuple(row,fk.columns);
      if (value === undefined) { unverified.add(name); continue; }
      const nulls = value.filter(v=>v==null).length;
      if (nulls === value.length || (fk.match === "s" && nulls)) continue;
      checkedLinks++;
      if (nulls || !index.has(JSON.stringify(value))) broken++;
    }
    if (broken) { const prior=conflicts.get(name); conflicts.set(name,{table:fk.table,references:fk.references,links:(prior?.links??0)+broken}); }
  }
  return { checkedLinks, conflicts: [...conflicts.values()].sort((a,b)=>`${a.table}:${a.references}`.localeCompare(`${b.table}:${b.references}`)), unverified: [...unverified].sort() };
}
