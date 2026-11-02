"use client";

import type { ReactNode } from "react";
import { useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { Button, LoadingState, Panel } from "@o-okul/ui";

// Portal sayfaları her paneli kendi sorgusuyla yükler: bir panelin isteği düşerse yalnız o panel hata gösterir,
// "Tekrar dene" yalnız o panelin sorgusunu yeniler; üstteki özet ve aksiyon şeridi diğer paneller yüklenirken kalır.

export type PortalPanelStatus = "error" | "loading" | "ready";

export type PanelQuery = Pick<UseQueryResult<unknown>, "fetchStatus" | "isError" | "isFetching" | "isLoading" | "isPending" | "refetch">;

const emptyListValue: unknown[] = [];

/** Sabit boş liste; sorgu verisi gelmeden de bağımlılık dizileri her render'da değişmez. */
export function emptyList<T>(): T[] {
  return emptyListValue as T[];
}

export function usePortalPanelQuery<T>(queryKey: QueryKey, enabled: boolean, load: () => Promise<T>) {
  return useQuery({
    queryKey,
    queryFn: load,
    enabled,
    refetchOnWindowFocus: false,
  });
}

export function panelStatus(...queries: PanelQuery[]): PortalPanelStatus {
  if (queries.some((query) => query.isError)) return "error";
  if (queries.some((query) => query.isLoading)) return "loading";
  return "ready";
}

/** Yalnız hata durumundaki sorguları yeniler; başarılı paneller yeniden istenmez. */
export function retryFailedPanels(...queries: PanelQuery[]) {
  for (const query of queries) {
    if (query.isError) void query.refetch();
  }
}

/** Çalışan her panel düştüyse (bağlantı, oturum) sayfa bölüm bölüm hata yerine tek hata durumu gösterir. */
export function allPanelsFailed(queries: PanelQuery[]): boolean {
  const active = queries.filter((query) => !(query.isPending && query.fetchStatus === "idle"));
  return active.length > 0 && active.every((query) => query.isError);
}

export function isAnyPanelRetrying(queries: PanelQuery[]): boolean {
  return queries.some((query) => query.isError && query.isFetching);
}

/** Bir panelin verisi alınamadığında yerine geçer; "Tekrar dene" yalnız bu panelin verisini yeniden ister. */
export function PanelLoadError({
  id,
  label,
  onRetry,
  retrying = false,
  subject,
  title,
}: {
  id?: string;
  label: string;
  onRetry: () => void;
  retrying?: boolean;
  subject: string;
  title: string;
}) {
  return (
    <Panel aria-label={label} id={id} title={title}>
      <div role="alert">
        <p className="next-form-error">{subject} şu an alınamadı. Bağlantını kontrol edip tekrar dene.</p>
        <Button loading={retrying} loadingLabel="Yeniden deneniyor" onClick={onRetry} variant="secondary">Tekrar dene</Button>
      </div>
    </Panel>
  );
}

/** Panel verisi gelene kadar yerini tutar; sayfanın geri kalanı beklemeden gösterilir. */
export function PanelLoading({ id, label, title }: { id?: string; label: string; title: string }) {
  return (
    <Panel aria-busy="true" aria-label={label} id={id} title={title}>
      <LoadingState label={`${title} yükleniyor…`} />
    </Panel>
  );
}

/** Panel sorguları hazır olana kadar yükleme, düşerse kendi "Tekrar dene"siyle hata gösterir. */
export function PortalPanelGate({
  children,
  error,
  id,
  label,
  queries,
  subject,
  title,
}: {
  children: ReactNode;
  /** Varsayılan hata paneli yerine çizilecek içerik (ör. öğretmen bölüm satırı). */
  error?: (retry: () => void, retrying: boolean) => ReactNode;
  id?: string;
  label: string;
  queries: PanelQuery[];
  subject: string;
  title: string;
}) {
  const status = panelStatus(...queries);
  if (status === "error") {
    const retry = () => retryFailedPanels(...queries);
    const retrying = isAnyPanelRetrying(queries);
    return error ? <>{error(retry, retrying)}</> : (
      <PanelLoadError id={id} label={label} onRetry={retry} retrying={retrying} subject={subject} title={title} />
    );
  }
  if (status === "loading") return <PanelLoading id={id} label={label} title={title} />;
  return <>{children}</>;
}
