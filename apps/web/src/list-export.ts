import type { ListExportAuditRecord, ListExportAuditRequest, ListExportKind } from "@o-okul/shared-types";
import type { CrudPageExportOptions, DataTableSnapshot } from "@o-okul/ui";
import { apiBaseUrl, apiRequest } from "./api-client.js";

/**
 * Masked CSV export for staff list screens (DEC-20261102-08).
 *
 * The file holds exactly what the table shows: the columns on screen and the formatted, masked cell text of the rows
 * on the current page with the current filters. Nothing is fetched again and no unmasked value is read. Before the
 * file is built, POST /audit/list-exports records who exported which list and how many rows; when that call fails the
 * export does not happen. Portals never pass these options.
 */
export interface ListCsvExportInput {
  accessToken: string;
  /** File name stem, for example "ogrenciler"; the Istanbul date and ".csv" are appended. */
  fileName: string;
  filters: ListExportFilters;
  list: ListExportKind;
}

export type ListExportFilters = Record<string, boolean | number | string | null | undefined>;

export const listExportHint = "Yalnız bu sayfada görünen satırlar ve sütunlar, ekrandaki maskeli biçimiyle indirilir.";

export function listCsvExportOptions(input: ListCsvExportInput | null): CrudPageExportOptions | undefined {
  if (!input) return undefined;
  return {
    hint: listExportHint,
    label: "CSV indir",
    onExport: (snapshot) => exportListCsv(input, snapshot),
  };
}

export async function exportListCsv(input: ListCsvExportInput, snapshot: DataTableSnapshot): Promise<void> {
  if (snapshot.rows.length === 0) throw new Error("LIST_EXPORT_EMPTY");
  // Defence in depth: list cells are masked by their renderers; a cell that still looks like a national ID or a full
  // phone number stops the export before anything is recorded or written.
  if (snapshot.rows.some((row) => row.some(looksUnmasked))) throw new Error("LIST_EXPORT_UNMASKED_VALUE");

  const request: ListExportAuditRequest = {
    filtersSummary: buildListExportFiltersSummary(input.filters),
    list: input.list,
    rowCount: snapshot.rows.length,
  };
  await apiRequest<ListExportAuditRecord>(input.accessToken, `${apiBaseUrl}/audit/list-exports`, {
    body: JSON.stringify(request),
    headers: { "content-type": "application/json", "Idempotency-Key": globalThis.crypto.randomUUID() },
    method: "POST",
  });

  downloadCsv(`${input.fileName}-${istanbulDateStamp()}.csv`, buildListCsv(snapshot));
}

/** UTF-8 with BOM and ";" separators so Excel with Turkish regional settings opens the columns directly. */
export function buildListCsv(snapshot: DataTableSnapshot): string {
  const lines = [snapshot.headers, ...snapshot.rows].map((cells) => cells.map(toCsvField).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `key` or `key=value` pairs; search text is never sent, only that a search is active. */
export function buildListExportFiltersSummary(filters: ListExportFilters): string {
  const active = Object.entries(filters)
    .filter(([key, value]) => /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) && value !== undefined && value !== null && value !== "" && value !== false);
  const pairs = active.map(([key, value]) => {
    if (key === "q" || value === true) return key;
    const text = String(value);
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(text) ? `${key}=${text}` : key;
  });
  const summary = pairs.join(";");
  // The API caps the summary at 300 characters; past that only the active filter keys are kept.
  return summary.length <= 300 ? summary : active.map(([key]) => key).join(";").slice(0, 300);
}

function toCsvField(value: string): string {
  // Spreadsheet formula injection guard: a cell that starts like a formula is written as text.
  const guarded = /^[=+\-@\t\r]/.test(value) && !/^[-+]?\d+(?:[.,]\d+)?$/.test(value) && value !== "-" ? `'${value}` : value;
  return /[";\r\n]/.test(guarded) || guarded !== guarded.trim() ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

// Masked values carry "*" or "•" in place of digits, so they never match. Dates ("02.11.2026", "2026-11-02") are not
// phone numbers: candidates with a dot or a year-month-day shape, or with more than 13 digits, are skipped.
function looksUnmasked(value: string): boolean {
  if (/(?:^|\D)\d{11}(?:\D|$)/.test(value)) return true;
  const phoneLike = value.match(/\+?\d[\d\s()-]{8,}\d/g) ?? [];
  return phoneLike.some((candidate) => {
    const digitCount = candidate.replace(/\D/g, "").length;
    return digitCount >= 10 && digitCount <= 13 && !/\d{4}-\d{2}-\d{2}/.test(candidate);
  });
}

function istanbulDateStamp(): string {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date());
}

function downloadCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
