import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
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

/**
 * How a decoded sort key is validated before it reaches SQL: free text (no NUL, bounded) or a millisecond
 * ISO-8601 timestamp without zone (`YYYY-MM-DDTHH:MM:SS.mmm`, see `cursorTimestampKeySql`).
 */
export type CursorKeyFormat = "text" | "timestamp-ms";

interface SealedCursorPayload {
  k: string;
  id: string;
}

type CursorContextPart = string | number | boolean | null | undefined | readonly string[];

const cursorVersion = 3;
const cursorIvLength = 12;
const cursorTagLength = 16;
const cursorKeyMaxLength = 512;
const cursorIdMaxLength = 200;

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
 * break paging. The sort key is a personal value (a student's name or number, an e-mail), and cursors travel in API
 * query strings and screen URLs, so the payload is sealed with AES-256-GCM: version byte, random 96-bit IV, tag and
 * ciphertext, base64url. The list context is the GCM additional data, so a cursor from another tenant, filter or
 * sort fails authentication like a tampered one. The page query still applies every tenant and scope filter.
 */
export function encodeListCursor(context: string, position: CursorPosition): string {
  const iv = randomBytes(cursorIvLength);
  const cipher = createCipheriv("aes-256-gcm", listCursorKey(), iv, { authTagLength: cursorTagLength });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const payload: SealedCursorPayload = { k: position.key, id: position.id };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([cursorVersion]), iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

/**
 * Returns the keyset position; throws `errorCode` for a malformed, tampered or earlier-format (v1/v2) cursor, one
 * bound to another context, or a key that does not match `keyFormat` (so it never reaches SQL as a 500).
 */
export function decodeListCursor(
  cursor: string,
  context: string,
  errorCode: string,
  keyFormat: CursorKeyFormat = "text",
): CursorPosition {
  let payload: Partial<SealedCursorPayload>;
  try {
    const sealed = Buffer.from(cursor, "base64url");
    if (sealed.toString("base64url") !== cursor) throw new Error(errorCode);
    if (sealed.length <= 1 + cursorIvLength + cursorTagLength || sealed[0] !== cursorVersion) throw new Error(errorCode);
    const iv = sealed.subarray(1, 1 + cursorIvLength);
    const tag = sealed.subarray(1 + cursorIvLength, 1 + cursorIvLength + cursorTagLength);
    const decipher = createDecipheriv("aes-256-gcm", listCursorKey(), iv, { authTagLength: cursorTagLength });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(sealed.subarray(1 + cursorIvLength + cursorTagLength)), decipher.final()]);
    payload = JSON.parse(plaintext.toString("utf8")) as Partial<SealedCursorPayload>;
  } catch {
    throw new Error(errorCode);
  }
  if (!isValidCursorText(payload.id, cursorIdMaxLength) || !payload.id || !isValidCursorKey(payload.k, keyFormat)) {
    throw new Error(errorCode);
  }
  return { key: payload.k as string, id: payload.id };
}

function isValidCursorKey(value: unknown, format: CursorKeyFormat): boolean {
  if (!isValidCursorText(value, cursorKeyMaxLength)) return false;
  if (format === "text") return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function isValidCursorText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && !value.includes("\u0000");
}

/**
 * Text form of a timestamp(3) sort key that does not depend on the session DateStyle; the matching parameter is cast
 * back with `::timestamp(3)`, and PostgreSQL reads an ISO-8601 literal the same way under every DateStyle.
 */
export function cursorTimestampKeySql(column: string): string {
  return `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`;
}

// Key material: a dedicated AES-256 key derived with HKDF-SHA256 from JWT_ACCESS_SECRET, the server secret the API
// already requires in every environment (auth refuses a missing or default value in production) and that role
// preview and tenant selection tokens already build on. Rotating it only invalidates short-lived list cursors, which
// the web recovers from. Outside production and staging the same development default as auth is used.
const listCursorKeyInfo = "o-okul:list-cursor:v3";
const defaultDevelopmentAccessSecret = "test-access-secret";
let cachedCursorKey: { secret: string; key: Buffer } | undefined;

function listCursorKey(): Buffer {
  const configured = process.env.JWT_ACCESS_SECRET;
  const productionLike = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
  if (productionLike && (!configured || configured === defaultDevelopmentAccessSecret)) {
    throw new Error("JWT_ACCESS_SECRET_REQUIRED");
  }
  const secret = configured ?? defaultDevelopmentAccessSecret;
  if (cachedCursorKey?.secret !== secret) {
    const key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), listCursorKeyInfo, 32));
    cachedCursorKey = { secret, key };
  }
  return cachedCursorKey.key;
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
