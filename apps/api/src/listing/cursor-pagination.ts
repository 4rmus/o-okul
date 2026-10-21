import { createHash } from "node:crypto";
import type { ApiCursorListMeta } from "@o-okul/shared-types";

export type CursorDirection = "next" | "previous";
export type CursorSortDirection = "ASC" | "DESC";

export interface CursorPageQuery {
  cursor?: string;
  direction: CursorDirection;
  limit: number;
}

export interface CursorPage<TRecord> {
  records: TRecord[];
  meta: ApiCursorListMeta;
}

interface ListCursorPayload {
  v: 1;
  c: string;
  id: string;
}

type CursorContextPart = string | number | boolean | null | undefined | readonly string[];

/**
 * Binds a cursor to the list it came from: tenant, every filter and the sort. A cursor issued for another
 * tenant, filter set or sort fails `decodeListCursor` instead of silently paging a different result set.
 */
export function listCursorContext(list: string, tenantId: string, parts: Record<string, CursorContextPart>): string {
  const normalized = Object.keys(parts).sort().map((key) => {
    const value = parts[key];
    return [key, Array.isArray(value) ? [...value].sort() : value ?? null];
  });
  return createHash("sha256").update(JSON.stringify([list, tenantId, normalized])).digest("base64url");
}

export function encodeListCursor(context: string, id: string): string {
  const payload: ListCursorPayload = { v: 1, c: context, id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns the anchor record id; throws `errorCode` for a malformed cursor or one bound to another context. */
export function decodeListCursor(cursor: string, context: string, errorCode: string): string {
  let payload: Partial<ListCursorPayload>;
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (!decoded.length || decoded.toString("base64url") !== cursor) throw new Error(errorCode);
    payload = JSON.parse(decoded.toString("utf8")) as Partial<ListCursorPayload>;
  } catch {
    throw new Error(errorCode);
  }
  if (payload.v !== 1 || typeof payload.c !== "string" || typeof payload.id !== "string" || !payload.id || payload.c !== context) {
    throw new Error(errorCode);
  }
  return payload.id;
}

/** `>` or `<` for a keyset predicate `(key, id) <op> (anchorKey, anchorId)`. */
export function cursorComparison(sortDirection: CursorSortDirection, direction: CursorDirection): ">" | "<" {
  return (direction === "next") === (sortDirection === "ASC") ? ">" : "<";
}

/** The SQL order for the page query; a previous page is read in reverse and flipped back afterwards. */
export function cursorQueryOrder(sortDirection: CursorSortDirection, direction: CursorDirection): CursorSortDirection {
  if (direction === "next") return sortDirection;
  return sortDirection === "ASC" ? "DESC" : "ASC";
}

/**
 * Builds a page from `limit + 1` rows read in query order. `hasMore` is whether a row past the page exists in the
 * read direction; the opposite neighbour exists whenever a cursor was supplied.
 */
export function cursorPageFromRows<TRow, TRecord>(
  rows: TRow[],
  query: CursorPageQuery,
  context: string,
  idOf: (record: TRecord) => string,
  toRecord: (row: TRow) => TRecord,
  extraMeta: Partial<ApiCursorListMeta> = {},
): CursorPage<TRecord> {
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  if (query.direction === "previous") pageRows.reverse();
  const records = pageRows.map(toRecord);
  return { records, meta: cursorListMeta(records, query, context, idOf, hasMore, extraMeta) };
}

/** In-memory counterpart for stores that already hold the filtered, sorted list (tests and local driver). */
export function paginateCursorRecords<TRecord>(
  records: TRecord[],
  query: CursorPageQuery,
  context: string,
  idOf: (record: TRecord) => string,
  errorCode: string,
  extraMeta: Partial<ApiCursorListMeta> = {},
): CursorPage<TRecord> {
  const cursorId = query.cursor ? decodeListCursor(query.cursor, context, errorCode) : undefined;
  const anchorIndex = cursorId ? records.findIndex((record) => idOf(record) === cursorId) : -1;
  if (cursorId && anchorIndex < 0) throw new Error(errorCode);
  const start = query.direction === "previous"
    ? Math.max(0, anchorIndex - query.limit)
    : cursorId ? anchorIndex + 1 : 0;
  const end = query.direction === "previous" ? anchorIndex : start + query.limit;
  const page = records.slice(start, end);
  const hasMore = query.direction === "previous" ? start > 0 : end < records.length;
  return { records: page, meta: cursorListMeta(page, query, context, idOf, hasMore, extraMeta) };
}

function cursorListMeta<TRecord>(
  records: TRecord[],
  query: CursorPageQuery,
  context: string,
  idOf: (record: TRecord) => string,
  hasMore: boolean,
  extraMeta: Partial<ApiCursorListMeta>,
): ApiCursorListMeta {
  const first = records[0];
  const last = records.at(-1);
  const meta: ApiCursorListMeta = { limit: query.limit, ...extraMeta };
  if (first && (query.direction === "previous" ? hasMore : Boolean(query.cursor))) {
    meta.previousCursor = encodeListCursor(context, idOf(first));
  }
  if (last && (query.direction === "next" ? hasMore : Boolean(query.cursor))) {
    meta.nextCursor = encodeListCursor(context, idOf(last));
  }
  return meta;
}

/** Lower-cased `%term%` LIKE pattern with `\`, `%` and `_` escaped (pair with `ESCAPE '\'`). */
export function likeSearchPattern(value: string | undefined, locale?: string): string | null {
  const normalized = normalizeSearchTerm(value, locale);
  return normalized ? `%${normalized.replace(/[\\%_]/g, "\\$&")}%` : null;
}

export function normalizeSearchTerm(value: string | undefined, locale?: string): string {
  const trimmed = value?.trim() ?? "";
  return locale ? trimmed.toLocaleLowerCase(locale) : trimmed.toLowerCase();
}
