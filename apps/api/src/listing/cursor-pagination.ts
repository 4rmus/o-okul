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

/** Keyset position: the row's sort-key value (as text) and its id tie-breaker. */
export interface CursorPosition {
  key: string;
  id: string;
}

interface ListCursorPayload {
  v: 2;
  c: string;
  k: string;
  id: string;
}

type CursorContextPart = string | number | boolean | null | undefined | readonly string[];

/**
 * Binds a cursor to the list it came from: tenant, every request filter and the sort. A cursor issued for another
 * tenant, filter set or sort fails `decodeListCursor` instead of silently paging a different result set.
 */
export function listCursorContext(list: string, tenantId: string, parts: Record<string, CursorContextPart>): string {
  const normalized = Object.keys(parts).sort().map((key) => {
    const value = parts[key];
    return [key, Array.isArray(value) ? [...value].sort() : value ?? null];
  });
  return createHash("sha256").update(JSON.stringify([list, tenantId, normalized])).digest("base64url");
}

/**
 * The cursor carries the boundary row's sort key and id, so the next page is `(key, id) > (cursor.key, cursor.id)`
 * without re-reading that row: a boundary row that is deleted, filtered out or renamed between requests does not
 * break paging. Key and id are client-controlled values, but the page query keeps every tenant and scope filter,
 * so a forged position can only move within rows the caller may already list.
 */
export function encodeListCursor(context: string, position: CursorPosition): string {
  const payload: ListCursorPayload = { v: 2, c: context, k: position.key, id: position.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns the keyset position; throws `errorCode` for a malformed cursor or one bound to another context. */
export function decodeListCursor(cursor: string, context: string, errorCode: string): CursorPosition {
  let payload: Partial<ListCursorPayload>;
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (!decoded.length || decoded.toString("base64url") !== cursor) throw new Error(errorCode);
    payload = JSON.parse(decoded.toString("utf8")) as Partial<ListCursorPayload>;
  } catch {
    throw new Error(errorCode);
  }
  if (
    payload.v !== 2 ||
    typeof payload.c !== "string" ||
    typeof payload.k !== "string" ||
    typeof payload.id !== "string" ||
    !payload.id ||
    payload.c !== context
  ) {
    throw new Error(errorCode);
  }
  return { key: payload.k, id: payload.id };
}

/** `>` or `<` for a keyset predicate `(key, id) <op> (cursorKey, cursorId)`. */
export function cursorComparison(sortDirection: CursorSortDirection, direction: CursorDirection): ">" | "<" {
  return (direction === "next") === (sortDirection === "ASC") ? ">" : "<";
}

/** The SQL order for the page query; a previous page is read in reverse and flipped back afterwards. */
export function cursorQueryOrder(sortDirection: CursorSortDirection, direction: CursorDirection): CursorSortDirection {
  if (direction === "next") return sortDirection;
  return sortDirection === "ASC" ? "DESC" : "ASC";
}

/**
 * Keyset predicate against a decoded cursor. `keySql` must be the same expression the query orders by and selects
 * as text for the next cursor; `keyType` casts the text key back (for example `timestamp(3)`).
 */
export function cursorKeysetCondition(
  keySql: string,
  idSql: string,
  sortDirection: CursorSortDirection,
  direction: CursorDirection,
  position: CursorPosition,
  values: unknown[],
  keyType = "text",
): string {
  values.push(position.key, position.id);
  const keyParameter = `$${values.length - 1}`;
  const idParameter = `$${values.length}`;
  return `(${keySql}, ${idSql}) ${cursorComparison(sortDirection, direction)} (${keyParameter}::${keyType}, ${idParameter}::text)`;
}

/**
 * Builds a page from `limit + 1` rows read in query order. `hasMore` is whether a row past the page exists in the
 * read direction; the opposite neighbour exists whenever a cursor was supplied.
 */
export function cursorPageFromRows<TRow, TRecord>(
  rows: TRow[],
  query: CursorPageQuery,
  context: string,
  positionOf: (row: TRow) => CursorPosition,
  toRecord: (row: TRow) => TRecord,
  extraMeta: Partial<ApiCursorListMeta> = {},
): CursorPage<TRecord> {
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  if (query.direction === "previous") pageRows.reverse();
  return {
    records: pageRows.map(toRecord),
    meta: cursorListMeta(pageRows.map(positionOf), query, context, hasMore, extraMeta),
  };
}

/**
 * In-memory counterpart for stores holding the filtered list (tests and the local driver). Rows are ordered by the
 * same `(key, id)` code-point order the cursor compares with, so a missing boundary row does not matter here either.
 */
export function paginateCursorRecords<TRecord>(
  records: TRecord[],
  query: CursorPageQuery,
  context: string,
  positionOf: (record: TRecord) => CursorPosition,
  sortDirection: CursorSortDirection,
  errorCode: string,
  extraMeta: Partial<ApiCursorListMeta> = {},
): CursorPage<TRecord> {
  const cursor = query.cursor ? decodeListCursor(query.cursor, context, errorCode) : undefined;
  const sign = sortDirection === "ASC" ? 1 : -1;
  const ordered = records
    .map((record) => ({ record, position: positionOf(record) }))
    .sort((left, right) => sign * comparePositions(left.position, right.position));
  const beforeCursor = (position: CursorPosition) => cursor !== undefined && sign * comparePositions(position, cursor) < 0;
  const afterCursor = (position: CursorPosition) => cursor !== undefined && sign * comparePositions(position, cursor) > 0;

  let page: typeof ordered;
  let hasMore: boolean;
  if (query.direction === "previous" && cursor) {
    const candidates = ordered.filter((entry) => beforeCursor(entry.position));
    page = candidates.slice(-query.limit);
    hasMore = candidates.length > query.limit;
  } else {
    const candidates = cursor ? ordered.filter((entry) => afterCursor(entry.position)) : ordered;
    page = candidates.slice(0, query.limit);
    hasMore = candidates.length > query.limit;
  }
  return {
    records: page.map((entry) => entry.record),
    meta: cursorListMeta(page.map((entry) => entry.position), query, context, hasMore, extraMeta),
  };
}

function comparePositions(left: CursorPosition, right: CursorPosition): number {
  return compareCodePoints(left.key, right.key) || compareCodePoints(left.id, right.id);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cursorListMeta(
  positions: CursorPosition[],
  query: CursorPageQuery,
  context: string,
  hasMore: boolean,
  extraMeta: Partial<ApiCursorListMeta>,
): ApiCursorListMeta {
  const first = positions[0];
  const last = positions.at(-1);
  const meta: ApiCursorListMeta = { limit: query.limit, ...extraMeta };
  if (first && (query.direction === "previous" ? hasMore : Boolean(query.cursor))) {
    meta.previousCursor = encodeListCursor(context, first);
  }
  if (last && (query.direction === "next" ? hasMore : Boolean(query.cursor))) {
    meta.nextCursor = encodeListCursor(context, last);
  }
  return meta;
}

// Turkish-aware search folding, applied identically to the stored column (SQL) and the search term (JS). Names are
// stored Turkish-uppercased ("IŞIK", "İSMAİL"); PostgreSQL lower() maps I to i and İ to i̇, while a tr-TR lowercase
// maps I to ı. Folding every I variant to a plain i on both sides makes "ışık", "IŞIK" and "Işık" match each other
// and "ismail"/"İsmail" match "İSMAİL". The remaining Turkish capitals are translated explicitly so the match does
// not depend on the database's ctype. The folded expression does not use the existing lower(...) trigram indexes.
const turkishFoldFrom = "İIıŞĞÇÖÜ";
const turkishFoldTo = "iiişğçöü";

/** SQL counterpart of `foldSearchText`: `lower(translate(<expr>, 'İIıŞĞÇÖÜ', 'iiişğçöü'))`. */
export function foldedSearchSql(expression: string): string {
  return `lower(translate(${expression}, '${turkishFoldFrom}', '${turkishFoldTo}'))`;
}

export function foldSearchText(value: string): string {
  let folded = "";
  for (const character of value) {
    const index = turkishFoldFrom.indexOf(character);
    folded += index >= 0 ? turkishFoldTo[index] : character;
  }
  return folded.toLowerCase();
}

/** Trimmed, folded search term ("" when absent); also the value cursor contexts bind `q` to. */
export function normalizeSearchTerm(value: string | undefined): string {
  return foldSearchText(value?.trim() ?? "");
}

/** Folded `%term%` LIKE pattern with `\`, `%` and `_` escaped (pair with `ESCAPE '\'` and `foldedSearchSql`). */
export function likeSearchPattern(value: string | undefined): string | null {
  const normalized = normalizeSearchTerm(value);
  return normalized ? `%${normalized.replace(/[\\%_]/g, "\\$&")}%` : null;
}
