"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { Button, Dialog, Field, Input } from "@o-okul/ui";
import { type GlobalSearchResultRecord } from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, withQueryParams } from "../../../src/api-client.js";
import { hasCapabilityForRoles, hasInstitutionAccess, hasSystemAccess } from "../_shared/access.js";
import { commandActions } from "../../../src/route-manifest.js";
import type { NavigationGroup } from "./nav-sidebar.js";
export interface CommandPaletteItem {
  group: string;
  href: string;
  id: string;
  label: string;
}

const entitySearchLimit = 12;
interface EntitySearchResult {
  group: string;
  href: string;
  id: string;
  label: string;
  subtitle?: string;
}

export function focusCommandOpener(preferredOpener: HTMLButtonElement | null) {
  const candidates = [
    preferredOpener,
    ...Array.from(document.querySelectorAll<HTMLButtonElement>('.next-command-open[aria-label="Komut paleti"]')),
  ];
  const opener = candidates.find((candidate) => candidate && candidate.getClientRects().length > 0 && !candidate.disabled);
  opener?.focus();
}

export function CommandPalette({
  accessToken,
  enableEntitySearch,
  items,
  onClose,
  onNavigate,
  open,
  query,
  setQuery,
}: {
  accessToken: string;
  enableEntitySearch: boolean;
  items: CommandPaletteItem[];
  onClose(): void;
  onNavigate(href: string): void;
  open: boolean;
  query: string;
  setQuery(value: string): void;
}) {
  const filteredItems = filterCommandItems(items, query);
  const [entityResults, setEntityResults] = useState<EntitySearchResult[]>([]);
  const [isEntitySearchLoading, setIsEntitySearchLoading] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const showEntitySearch = enableEntitySearch && normalizeCommandText(query).length >= 2;
  const visibleEntityResults = showEntitySearch ? entityResults : [];
  // Komutlar ve varlık sonuçları tek listbox içinde sıralanır; ok tuşları ikisini birlikte gezer.
  const options = [...filteredItems, ...visibleEntityResults];
  const optionCount = options.length;
  const activeOptionIndex = optionCount > 0 ? Math.min(activeIndex, optionCount - 1) : -1;
  const activeOptionId = activeOptionIndex >= 0 ? optionId(activeOptionIndex) : undefined;
  // Sorgu değiştiği an (debounce başlamadan önce) da arama sürüyor sayılır; "Sonuç yok" erken görünmez.
  const isSearching = showEntitySearch && (isEntitySearchLoading || searchedQuery !== query);
  const resultStatus = optionCount > 0
    ? `${optionCount} sonuç${isSearching ? ", varlık araması sürüyor" : ""}`
    : isSearching ? "Aranıyor..." : "Sonuç yok";

  function optionId(index: number) {
    return `${baseId}-option-${index}`;
  }

  function handleCommandItemClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      onClose();
      return;
    }

    event.preventDefault();
    onNavigate(href);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (optionCount === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeOptionIndex + step + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      const activeOption = activeOptionIndex >= 0 ? options[activeOptionIndex] : undefined;
      if (!activeOption) return;
      event.preventDefault();
      onNavigate(activeOption.href);
    }
  }

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || !activeOptionId) return;
    const activeOption = listboxRef.current?.querySelector<HTMLElement>(`[id="${activeOptionId}"]`);
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId, open]);

  useEffect(() => {
    const normalizedQuery = normalizeCommandText(query);
    if (!enableEntitySearch || normalizedQuery.length < 2) {
      setEntityResults([]);
      setSearchedQuery("");
      setIsEntitySearchLoading(false);
      return;
    }

    let isStale = false;
    setIsEntitySearchLoading(true);
    const timeoutId = window.setTimeout(() => {
      void searchEntities(accessToken, query)
        .then((results) => {
          if (!isStale) setEntityResults(results);
        })
        .catch(() => {
          if (!isStale) setEntityResults([]);
        })
        .finally(() => {
          if (!isStale) {
            setSearchedQuery(query);
            setIsEntitySearchLoading(false);
          }
        });
    }, 180);

    return () => {
      isStale = true;
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, enableEntitySearch, query]);

  function renderOption(item: CommandPaletteItem | EntitySearchResult, index: number, detail: string) {
    const isActive = index === activeOptionIndex;
    return (
      <Link
        aria-selected={isActive}
        href={item.href}
        id={optionId(index)}
        key={item.id}
        onClick={(event) => handleCommandItemClick(event, item.href)}
        onMouseMove={() => {
          if (!isActive) setActiveIndex(index);
        }}
        role="option"
        tabIndex={-1}
      >
        <span>{item.label}</span>
        <small>{detail}</small>
      </Link>
    );
  }

  return (
    <Dialog
      className="next-command-palette"
      description="Yetkili olduğunuz modüller ve kurum kayıtları içinde hızlı geçiş yapın."
      footer={<Button onClick={onClose} variant="secondary">Kapat</Button>}
      onClose={onClose}
      open={open}
      title="Komut paleti"
    >
      <div className="next-command-panel">
        <Field className="next-command-search" label="Komut ara">
          <Input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={optionCount > 0}
            autoComplete="off"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            value={query}
          />
        </Field>
        <p aria-live="polite" className="uh-visually-hidden" role="status">{resultStatus}</p>
        <div aria-label="Komut sonuçları" className="next-command-results" id={listboxId} ref={listboxRef} role="listbox">
          {filteredItems.length > 0 ? (
            <div aria-label="Komutlar" className="next-command-results" role="group">
              {filteredItems.map((item, index) => renderOption(item, index, item.group))}
            </div>
          ) : null}
          {showEntitySearch && (isSearching || optionCount > 0) ? (
            <div aria-label="Varlık araması" className="next-command-results" role="group">
              <h3 aria-hidden="true">Varlık araması</h3>
              {isSearching ? <p aria-hidden="true">Aranıyor...</p> : null}
              {!isSearching && visibleEntityResults.length === 0 ? <p aria-hidden="true">Varlık sonucu yok</p> : null}
              {visibleEntityResults.map((item, index) =>
                renderOption(item, filteredItems.length + index, item.subtitle ? `${item.group} · ${item.subtitle}` : item.group),
              )}
            </div>
          ) : null}
        </div>
        {optionCount === 0 && !isSearching ? (
          <div className="next-command-results">
            <p>Sonuç yok</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function buildCommandItems(
  institutionGroups: readonly NavigationGroup[],
  systemGroups: readonly NavigationGroup[],
  portalGroups: readonly NavigationGroup[],
  roles: readonly string[],
): CommandPaletteItem[] {
  const navigationItems = [
    ...institutionGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...systemGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...portalGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
  ];
  const actionItems = commandActions
    .filter((action) =>
      action.scope === "system"
        ? hasSystemAccess(roles)
        : hasInstitutionAccess(roles) && (!action.capability || hasCapabilityForRoles(roles, action.capability)),
    )
    .map((action) => commandItem(action.href, action.label, action.group));

  return dedupeCommandItems([...navigationItems, ...actionItems]);
}

export function canUseEntitySearch(roles: readonly string[]) {
  return hasCapabilityForRoles(roles, "search:read");
}

function commandItem(href: string, label: string, group: string): CommandPaletteItem {
  return { group, href, id: `${group}:${label}:${href}`, label };
}

function dedupeCommandItems(items: CommandPaletteItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function filterCommandItems(items: CommandPaletteItem[], query: string) {
  const normalizedQuery = normalizeCommandText(query);
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    normalizeCommandText(`${item.label} ${item.group} ${item.href}`).includes(normalizedQuery),
  );
}

async function searchEntities(accessToken: string, query: string): Promise<EntitySearchResult[]> {
  try {
    const url = withQueryParams(`${apiBaseUrl}/search`, { limit: String(entitySearchLimit), q: query });
    const results = (await apiListRequest<GlobalSearchResultRecord>(accessToken, url)).data;
    return results.map((result) => ({
      group: searchResultGroupLabel(result.type),
      href: result.href,
      id: `${result.type}:${result.id}`,
      label: result.title,
      subtitle: result.subtitle,
    }));
  } catch {
    return [];
  }
}

function searchResultGroupLabel(type: GlobalSearchResultRecord["type"]): string {
  if (type === "students") return "Öğrenci";
  if (type === "teachers") return "Öğretmen";
  if (type === "guardians") return "Veli";
  return "Sınıf";
}

function normalizeCommandText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}
