import { z } from "zod";
import { listExportKinds, listExportMaxRowCount, type ListExportAuditRequest } from "@o-okul/shared-types";

// `key` or `key=value` pairs joined with ";". Values are ids, sort keys or page numbers; free text (search) never
// fits the pattern, so a name typed into the search box cannot reach the audit record (DEC-20261102-08).
const filtersSummaryPattern = /^(?:[A-Za-z][A-Za-z0-9]{0,39}(?:=[A-Za-z0-9_.:-]{1,64})?(?:;[A-Za-z][A-Za-z0-9]{0,39}(?:=[A-Za-z0-9_.:-]{1,64})?)*)?$/;

export const listExportAuditBodySchema = z.object({
  filtersSummary: z.string().trim().max(300).regex(filtersSummaryPattern, "LIST_EXPORT_FILTERS_SUMMARY_INVALID"),
  list: z.enum(listExportKinds),
  rowCount: z.number().int().min(1).max(listExportMaxRowCount),
}).strict() satisfies z.ZodType<ListExportAuditRequest>;

export type ListExportAuditBody = ListExportAuditRequest;
