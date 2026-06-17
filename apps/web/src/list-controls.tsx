"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@uzman-hocam/ui";
import type { ListMeta } from "./api-client.js";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export interface ListQueryState {
  page: number;
  limit: number;
  q: string;
  sort: string;
}

export interface SortOption {
  label: string;
  value: string;
}

interface ListSearchParamsLike {
  get(name: string): string | null;
  toString(): string;
}

interface UrlListStateOptions {
  namespace?: string;
  sortOptions: SortOption[];
}

export const initialListQuery: ListQueryState = {
  page: 1,
  limit: 10,
  q: "",
  sort: "",
};

export function buildListUrl(baseUrl: string, state: ListQueryState): string {
  const query = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });
  const search = state.q.trim();
  if (search) query.set("q", search);
  if (state.sort) query.set("sort", state.sort);
  return `${baseUrl}?${query.toString()}`;
}

export function useUrlListState(
  searchParams: ListSearchParamsLike,
  { namespace = "", sortOptions }: UrlListStateOptions,
): [ListQueryState, (state: ListQueryState) => void] {
  const searchParamsKey = searchParams.toString();
  const sortValues = useMemo(() => new Set(sortOptions.map((option) => option.value)), [sortOptions]);
  const urlState = useMemo(
    () => readListQueryFromUrl(new URLSearchParams(searchParamsKey), namespace, sortValues),
    [namespace, searchParamsKey, sortValues],
  );
  const [state, setState] = useState<ListQueryState>(urlState);

  useEffect(() => {
    setState((current) => (isSameListQuery(current, urlState) ? current : urlState));
  }, [urlState]);

  return [
    state,
    (nextState) => {
      const normalizedState = normalizeListQuery(nextState, sortValues);
      setState(normalizedState);
      writeListQueryToUrl(normalizedState, namespace);
    },
  ];
}

export function ListControls({
  meta,
  onChange,
  searchPlaceholder = "Ara",
  sortOptions,
  state,
}: {
  meta?: ListMeta;
  onChange(state: ListQueryState): void;
  searchPlaceholder?: string;
  sortOptions: SortOption[];
  state: ListQueryState;
}) {
  const page = meta?.page ?? state.page;
  const totalPages = meta?.totalPages ?? 0;
  const total = meta?.total ?? 0;
  const canGoBack = page > 1;
  const canGoForward = totalPages > 0 && page < totalPages;

  return (
    <div className="next-list-controls">
      <label className="next-list-search">
        <Search size={17} aria-hidden="true" />
        <Input
          aria-label="Ara"
          placeholder={searchPlaceholder}
          value={state.q}
          onChange={(event) => onChange({ ...state, page: 1, q: event.target.value })}
        />
      </label>
      <label>
        Sırala
        <select value={state.sort} onChange={(event) => onChange({ ...state, page: 1, sort: event.target.value })}>
          <option value="">Varsayılan</option>
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Göster
        <select
          value={state.limit}
          onChange={(event) => onChange({ ...state, page: 1, limit: Number(event.target.value) })}
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
        </select>
      </label>
      <span className="next-list-status">{total} kayıt</span>
      <Button
        aria-label="Önceki sayfa"
        disabled={!canGoBack}
        onClick={() => onChange({ ...state, page: Math.max(1, page - 1) })}
        variant="secondary"
      >
        <ChevronLeft size={17} aria-hidden="true" />
      </Button>
      <span className="next-list-status">
        {page}/{Math.max(totalPages, 1)}
      </span>
      <Button
        aria-label="Sonraki sayfa"
        disabled={!canGoForward}
        onClick={() => onChange({ ...state, page: page + 1 })}
        variant="secondary"
      >
        <ChevronRight size={17} aria-hidden="true" />
      </Button>
    </div>
  );
}

function readListQueryFromUrl(
  searchParams: ListSearchParamsLike,
  namespace: string,
  sortValues: ReadonlySet<string>,
): ListQueryState {
  return normalizeListQuery({
    page: readPositiveInteger(searchParams.get(listQueryParamName("page", namespace))) ?? initialListQuery.page,
    limit: readListLimit(searchParams.get(listQueryParamName("limit", namespace))) ?? initialListQuery.limit,
    q: searchParams.get(listQueryParamName("q", namespace)) ?? initialListQuery.q,
    sort: searchParams.get(listQueryParamName("sort", namespace)) ?? initialListQuery.sort,
  }, sortValues);
}

function writeListQueryToUrl(state: ListQueryState, namespace: string) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set(listQueryParamName("page", namespace), String(state.page));
  url.searchParams.set(listQueryParamName("limit", namespace), String(state.limit));
  setOptionalQueryParam(url.searchParams, listQueryParamName("q", namespace), state.q.trim());
  setOptionalQueryParam(url.searchParams, listQueryParamName("sort", namespace), state.sort);
  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function normalizeListQuery(state: ListQueryState, sortValues: ReadonlySet<string>): ListQueryState {
  return {
    page: readPositiveInteger(String(state.page)) ?? initialListQuery.page,
    limit: readListLimit(String(state.limit)) ?? initialListQuery.limit,
    q: state.q.trim(),
    sort: sortValues.has(state.sort) ? state.sort : initialListQuery.sort,
  };
}

function listQueryParamName(name: keyof ListQueryState, namespace: string) {
  if (!namespace) return name;
  return `${namespace}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function setOptionalQueryParam(searchParams: URLSearchParams, name: string, value: string) {
  if (value) {
    searchParams.set(name, value);
    return;
  }
  searchParams.delete(name);
}

function readPositiveInteger(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readListLimit(value: string | null) {
  const parsed = readPositiveInteger(value);
  return parsed === 5 || parsed === 10 || parsed === 20 ? parsed : null;
}

function isSameListQuery(left: ListQueryState, right: ListQueryState) {
  return left.page === right.page && left.limit === right.limit && left.q === right.q && left.sort === right.sort;
}
