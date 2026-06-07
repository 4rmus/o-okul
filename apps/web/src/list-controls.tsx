"use client";

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
