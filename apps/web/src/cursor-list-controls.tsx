"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Field, FilterBar, Input, Select } from "@o-okul/ui";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { ApiRequestError, type CursorListMeta } from "./api-client.js";
import type { SortOption } from "./list-controls.js";

/** Cursor-paged list state (GET /employees contract): the opaque cursor replaces the page number. */
export interface CursorListQueryState {
  cursor?: string;
  direction: "next" | "previous";
  limit: number;
  q: string;
  sort: string;
}

interface SearchParamsReader {
  get(name: string): string | null;
}

interface SearchParamsLike extends SearchParamsReader {
  toString(): string;
}

export const initialCursorListQuery: CursorListQueryState = {
  direction: "next",
  limit: 10,
  q: "",
  sort: "",
};

const cursorListLimits = [5, 10, 20];

export function buildCursorListUrl(baseUrl: string, state: CursorListQueryState): string {
  const query = new URLSearchParams({ limit: String(state.limit) });
  if (state.cursor) {
    query.set("cursor", state.cursor);
    query.set("direction", state.direction);
  }
  const search = state.q.trim();
  if (search) query.set("q", search);
  if (state.sort) query.set("sort", state.sort);
  return `${baseUrl}?${query.toString()}`;
}

/** Any change to search, sort, page size or filters starts again from the first page: a cursor is bound to them. */
export function resetListCursor(
  state: CursorListQueryState,
  changes: Partial<Pick<CursorListQueryState, "limit" | "q" | "sort">> = {},
): CursorListQueryState {
  return { ...state, ...changes, cursor: undefined, direction: "next" };
}

/** A 400 *_CURSOR_INVALID: the cursor belongs to another tenant, filter, sort or an earlier cursor format. */
export function isCursorInvalidError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 400 && /_CURSOR_INVALID$/u.test(error.code ?? "");
}

/**
 * Loads a cursor page; when the API refuses the cursor (for example a stale one kept in the URL), reports the
 * cursor-free state through `onReset` so the screen drops it from state and URL, and returns the first page.
 */
export async function loadCursorPageWithRecovery<TState extends { cursor?: string; direction: "next" | "previous" }, T>(
  state: TState,
  load: (state: TState) => Promise<T>,
  onReset: (state: TState) => void,
): Promise<T> {
  try {
    return await load(state);
  } catch (error) {
    if (!state.cursor || !isCursorInvalidError(error)) throw error;
    const firstPage: TState = { ...state, cursor: undefined, direction: "next" };
    onReset(firstPage);
    return load(firstPage);
  }
}

export function readCursorListQueryFromUrl(
  searchParams: SearchParamsReader,
  { defaultState = initialCursorListQuery, namespace = "", sortValues }: {
    defaultState?: CursorListQueryState;
    namespace?: string;
    sortValues: ReadonlySet<string>;
  },
): CursorListQueryState {
  const cursor = searchParams.get(paramName("cursor", namespace))?.trim() || undefined;
  const sort = searchParams.get(paramName("sort", namespace)) ?? defaultState.sort;
  const limit = Number(searchParams.get(paramName("limit", namespace)));
  return {
    cursor,
    direction: cursor && searchParams.get(paramName("direction", namespace)) === "previous" ? "previous" : "next",
    limit: cursorListLimits.includes(limit) ? limit : defaultState.limit,
    q: searchParams.get(paramName("q", namespace)) ?? defaultState.q,
    sort: sortValues.has(sort) ? sort : defaultState.sort,
  };
}

/** Writes the cursor state into `params` and drops the retired page parameter. */
export function writeCursorListQueryParams(
  params: URLSearchParams,
  state: CursorListQueryState,
  { defaultState = initialCursorListQuery, namespace = "" }: { defaultState?: CursorListQueryState; namespace?: string } = {},
) {
  params.delete(paramName("page", namespace));
  setOptionalParam(params, paramName("cursor", namespace), state.cursor ?? "");
  setOptionalParam(params, paramName("direction", namespace), state.cursor && state.direction === "previous" ? "previous" : "");
  setOptionalParam(params, paramName("limit", namespace), state.limit === defaultState.limit ? "" : String(state.limit));
  setOptionalParam(params, paramName("q", namespace), state.q.trim());
  setOptionalParam(params, paramName("sort", namespace), state.sort);
}

export function useUrlCursorListState(
  searchParams: SearchParamsLike,
  { defaultState = initialCursorListQuery, namespace = "", sortOptions }: {
    defaultState?: CursorListQueryState;
    namespace?: string;
    sortOptions: SortOption[];
  },
): [CursorListQueryState, (state: CursorListQueryState) => void] {
  const searchParamsKey = searchParams.toString();
  const sortValues = useMemo(() => new Set(sortOptions.map((option) => option.value)), [sortOptions]);
  const urlState = useMemo(
    () => readCursorListQueryFromUrl(new URLSearchParams(searchParamsKey), { defaultState, namespace, sortValues }),
    [defaultState, namespace, searchParamsKey, sortValues],
  );
  const [state, setState] = useState<CursorListQueryState>(urlState);

  useEffect(() => {
    setState((current) => (isSameCursorListQuery(current, urlState) ? current : urlState));
  }, [urlState]);

  return [
    state,
    (nextState) => {
      setState(nextState);
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      writeCursorListQueryParams(url.searchParams, nextState, { defaultState, namespace });
      window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    },
  ];
}

/** ListControls for cursor lists: same search, sort and size controls; previous/next follow the response cursors. */
export function CursorListControls({
  children,
  meta,
  onChange,
  searchPlaceholder = "Ara",
  sortOptions,
  state,
}: {
  children?: ReactNode;
  meta?: CursorListMeta;
  onChange(state: CursorListQueryState): void;
  searchPlaceholder?: string;
  sortOptions: SortOption[];
  state: CursorListQueryState;
}) {
  const activeFilterSummary = [
    state.q.trim() ? "Arama aktif" : "",
    state.sort ? "Sıralama seçili" : "",
    state.limit !== initialCursorListQuery.limit ? `${state.limit} kayıt` : "",
  ].filter(Boolean).join(" · ") || "Sıralama ve sayfalama";

  return (
    <FilterBar className="next-list-controls" role="group" aria-label="Liste kontrolleri">
      <Field className="next-list-search" label="Ara">
        <Search size={17} aria-hidden="true" />
        <Input
          aria-label="Ara"
          placeholder={searchPlaceholder}
          value={state.q}
          onChange={(event) => onChange(resetListCursor(state, { q: event.target.value }))}
        />
      </Field>
      <details className="next-list-filter-details" open>
        <summary>
          <span>Filtreler</span>
          <small>{activeFilterSummary}</small>
        </summary>
        <div className="next-list-filter-details__content">
          <Field label="Sırala">
            <Select value={state.sort} onChange={(event) => onChange(resetListCursor(state, { sort: event.target.value }))}>
              <option value="">Varsayılan</option>
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Göster">
            <Select value={state.limit} onChange={(event) => onChange(resetListCursor(state, { limit: Number(event.target.value) }))}>
              {cursorListLimits.map((limit) => (
                <option key={limit} value={limit}>{limit}</option>
              ))}
            </Select>
          </Field>
          {meta?.total === undefined ? null : (
            <span className="next-list-status" aria-live="polite" aria-atomic="true">
              {meta.total} kayıt
            </span>
          )}
          <div aria-label="Sayfalama" className="uh-pagination next-list-pagination" role="navigation">
            <Button
              aria-label="Önceki sayfa"
              disabled={!meta?.previousCursor}
              onClick={() => meta?.previousCursor && onChange({ ...state, cursor: meta.previousCursor, direction: "previous" })}
              size="sm"
              variant="secondary"
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </Button>
            <Button
              aria-label="Sonraki sayfa"
              disabled={!meta?.nextCursor}
              onClick={() => meta?.nextCursor && onChange({ ...state, cursor: meta.nextCursor, direction: "next" })}
              size="sm"
              variant="secondary"
            >
              <ChevronRight size={17} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </details>
      {children}
    </FilterBar>
  );
}

function isSameCursorListQuery(left: CursorListQueryState, right: CursorListQueryState) {
  return left.cursor === right.cursor
    && left.direction === right.direction
    && left.limit === right.limit
    && left.q === right.q
    && left.sort === right.sort;
}

function paramName(name: keyof CursorListQueryState | "page", namespace: string) {
  if (!namespace) return name;
  return `${namespace}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function setOptionalParam(params: URLSearchParams, name: string, value: string) {
  if (value) {
    params.set(name, value);
    return;
  }
  params.delete(name);
}
