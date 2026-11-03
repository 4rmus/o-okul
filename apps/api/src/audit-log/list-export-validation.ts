import { z } from "zod";
import { listExportKinds, listExportMaxRowCount, type ListExportAuditRequest, type ListExportKind } from "@o-okul/shared-types";

// `key` or `key=value` pairs joined with ";". Values are ids, sort keys or page numbers; free text (search) never
// fits the pattern, so a name typed into the search box cannot reach the audit record (DEC-20261102-08).
const filtersSummaryPattern = /^(?:[A-Za-z][A-Za-z0-9]{0,39}(?:=[A-Za-z0-9_.:-]{1,64})?(?:;[A-Za-z][A-Za-z0-9]{0,39}(?:=[A-Za-z0-9_.:-]{1,64})?)*)?$/;

export const listExportAuditBodySchema = z.object({
  filtersSummary: z.string().trim().max(300).regex(filtersSummaryPattern, "LIST_EXPORT_FILTERS_SUMMARY_INVALID"),
  list: z.enum(listExportKinds),
  rowCount: z.number().int().min(1).max(listExportMaxRowCount),
}).strict() satisfies z.ZodType<ListExportAuditRequest>;

export type ListExportAuditBody = ListExportAuditRequest;

/**
 * How one filter key reaches the audit record: `KEY_ONLY` keeps only that the filter was active (search text and the
 * opaque list cursor), a pattern keeps the value when it matches and otherwise falls back to the key alone.
 */
type ListExportFilterRule = "KEY_ONLY" | RegExp;

const recordIdValue = /^[A-Za-z0-9_.:-]{1,64}$/;
const pageValue = /^[1-9][0-9]{0,5}$/;
const sortValue = /^-?[A-Za-z][A-Za-z0-9]{0,39}$/;

/**
 * DEC-20261102-08: the filter keys each list screen sends (apps/web/app/(app)/kurum/{ogrenciler,ogretmenler,siniflar,
 * devamsizlik}). Any other key is dropped before the audit record is written, so a client cannot store arbitrary
 * labels or values in the audit log.
 */
export const listExportFilterRules: Readonly<Record<ListExportKind, Readonly<Record<string, ListExportFilterRule>>>> = {
  attendance: { classId: recordIdValue, page: pageValue, q: "KEY_ONLY", sort: sortValue },
  classes: { page: pageValue, q: "KEY_ONLY", sort: sortValue },
  students: {
    classId: recordIdValue,
    cursor: "KEY_ONLY",
    guardianLinked: /^(?:true|false)$/,
    level: recordIdValue,
    q: "KEY_ONLY",
    responsibleTeacherId: recordIdValue,
    sort: sortValue,
    status: /^(?:ACTIVE|PASSIVE|GRADUATED|TRANSFERRED)$/,
  },
  teachers: { page: pageValue, q: "KEY_ONLY", sort: sortValue },
};

/**
 * Keeps the allow-listed keys of `list` in the order sent, the first occurrence of each, with a value only when the
 * key's rule admits it. Search text (`q`) is never stored: the summary records only that a search was active.
 */
export function normalizeFiltersSummary(list: ListExportKind, value: string): string {
  const rules = listExportFilterRules[list];
  const seen = new Set<string>();
  const pairs: string[] = [];
  for (const rawPair of value.split(";")) {
    const pair = rawPair.trim();
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
    if (!rule || seen.has(key)) continue;
    seen.add(key);
    const filterValue = separator === -1 ? "" : pair.slice(separator + 1);
    pairs.push(rule !== "KEY_ONLY" && filterValue && rule.test(filterValue) ? `${key}=${filterValue}` : key);
  }
  return pairs.join(";");
}
