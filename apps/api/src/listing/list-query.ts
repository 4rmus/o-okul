import { BadRequestException } from "@nestjs/common";

export interface ListQuery {
  page?: string;
  limit?: string;
  q?: string;
  sort?: string;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListField<TRecord> {
  name: string;
  read(record: TRecord): string | number | undefined;
}

const listMetaSymbol = Symbol.for("o-okul.list-meta");

export function applyListQuery<TRecord>(
  records: TRecord[],
  query: ListQuery,
  fields: Array<ListField<TRecord>>,
): TRecord[] {
  const hasPagination = Boolean(query.page || query.limit);
  const pageNumber = query.page ? positiveInt(query.page, "LIST_PAGE_INVALID") : 1;
  const limitNumber = query.limit
    ? positiveInt(query.limit, "LIST_LIMIT_INVALID")
    : hasPagination
      ? 20
      : records.length;
  const normalizedQuery = query.q?.trim().toLocaleLowerCase("tr-TR");
  const filtered = normalizedQuery
    ? records.filter((record) =>
        fields.some((field) =>
          String(field.read(record) ?? "").toLocaleLowerCase("tr-TR").includes(normalizedQuery),
        ),
      )
    : records;
  const sorted = sortRecords(filtered, query.sort, fields);
  const paginated = hasPagination ? paginate(sorted, pageNumber, limitNumber) : sorted;
  return withListMeta(paginated, {
    total: filtered.length,
    page: pageNumber,
    limit: limitNumber,
    totalPages: filtered.length === 0 ? 0 : Math.ceil(filtered.length / limitNumber),
  });
}

function sortRecords<TRecord>(
  records: TRecord[],
  sort: string | undefined,
  fields: Array<ListField<TRecord>>,
): TRecord[] {
  const rawSort = sort?.trim();
  if (!rawSort) return records;

  const direction = rawSort.startsWith("-") || rawSort.endsWith(":desc") ? -1 : 1;
  const fieldName = rawSort.replace(/^-/, "").replace(/:(asc|desc)$/, "");
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new BadRequestException("LIST_SORT_INVALID");
  }

  return [...records].sort((left, right) =>
    direction * compareValues(field.read(left), field.read(right)),
  );
}

function paginate<TRecord>(records: TRecord[], pageNumber: number, limitNumber: number): TRecord[] {
  const start = (pageNumber - 1) * limitNumber;
  return records.slice(start, start + limitNumber);
}

function positiveInt(value: string, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(errorCode);
  }
  return parsed;
}

function compareValues(left: string | number | undefined, right: string | number | undefined): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""), "tr-TR", { sensitivity: "base" });
}

function withListMeta<TRecord>(records: TRecord[], meta: ListMeta): TRecord[] {
  Object.defineProperty(records, listMetaSymbol, {
    enumerable: false,
    value: meta,
  });
  return records;
}

export function readListMeta(records: unknown[]): ListMeta | undefined {
  return (records as { [listMetaSymbol]?: ListMeta })[listMetaSymbol];
}
