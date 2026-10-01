"use client";

import { useEffect, useState, type MouseEvent } from "react";
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
  const filteredItems = filterCommandItems(items, query).slice(0, 10);
  const [entityResults, setEntityResults] = useState<EntitySearchResult[]>([]);
  const [isEntitySearchLoading, setIsEntitySearchLoading] = useState(false);

  function handleCommandItemClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      onClose();
      return;
    }

    event.preventDefault();
    onNavigate(href);
  }

  useEffect(() => {
    const normalizedQuery = normalizeCommandText(query);
    if (!enableEntitySearch || normalizedQuery.length < 2) {
      setEntityResults([]);
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
          if (!isStale) setIsEntitySearchLoading(false);
        });
    }, 180);

    return () => {
      isStale = true;
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, enableEntitySearch, query]);

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
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <div className="next-command-results">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <Link key={item.id} href={item.href} onClick={(event) => handleCommandItemClick(event, item.href)}>
                <span>{item.label}</span>
                <small>{item.group}</small>
              </Link>
            ))
          ) : (
            <p>Sonuç yok</p>
          )}
        </div>
        {enableEntitySearch && normalizeCommandText(query).length >= 2 ? (
          <div className="next-command-results" aria-label="Varlık araması">
            <h3>Varlık araması</h3>
            {isEntitySearchLoading ? <p>Aranıyor...</p> : null}
            {!isEntitySearchLoading && entityResults.length === 0 ? <p>Varlık sonucu yok</p> : null}
            {entityResults.map((item) => (
              <Link key={item.id} href={item.href} onClick={(event) => handleCommandItemClick(event, item.href)}>
                <span>{item.label}</span>
                <small>{item.subtitle ? `${item.group} · ${item.subtitle}` : item.group}</small>
              </Link>
            ))}
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
