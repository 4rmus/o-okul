"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { classNames } from "../class-names.js";
import { Alert } from "./alert.js";
import { Button } from "./button.js";
import { DataTable, type DataTableColumn, type DataTableSelectionOptions } from "./data-table.js";
import { readDataTableSnapshot, type DataTableSnapshot, type ReadDataTableSnapshotOptions } from "./data-table-export.js";
import { Tooltip } from "./tooltip.js";

type CrudPageDensity = "comfortable" | "compact";

/**
 * İsteğe bağlı CSV dışa aktarma (DEC-20261102-08). Düğme tablonun o an gösterdiği satırların ve sütunların ekrandaki
 * (biçimlenmiş, maskeli) metnini `onExport`'a verir; veri yeniden çekilmez. `onExport` reddedilirse (örneğin denetim
 * kaydı yazılamadıysa) dosya oluşmaz ve hata mesajı gösterilir.
 */
export interface CrudPageExportOptions extends ReadDataTableSnapshotOptions {
  /** Hata mesajı; verilmezse genel metin gösterilir. */
  errorMessage?: string;
  /** Düğmenin açıklama ipucu. */
  hint?: string;
  label?: string;
  onExport(snapshot: DataTableSnapshot): Promise<void> | void;
}

export interface CrudPageProps<TRow> extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  columns: Array<DataTableColumn<TRow>>;
  description?: ReactNode;
  density?: CrudPageDensity;
  emptyState?: ReactNode;
  emptyText?: ReactNode;
  error?: ReactNode;
  /** Verildiğinde tablonun üstünde CSV dışa aktarma düğmesi çizilir; portallarda verilmez. */
  exportOptions?: CrudPageExportOptions;
  filteredEmptyState?: ReactNode;
  getRowKey(row: TRow): string;
  hasActiveFilters?: boolean;
  hideTitle?: boolean;
  loading?: boolean;
  rowClassName?(row: TRow): string | undefined;
  rows: TRow[];
  /** Verildiğinde tablo satır seçimi ve sabit başlık satırı taşır (S3). */
  selection?: DataTableSelectionOptions<TRow>;
  summary?: ReactNode;
  tableCaption?: ReactNode;
  tableDescription?: ReactNode;
  title?: ReactNode;
}

export function CrudPage<TRow>({
  actions,
  className,
  columns,
  description,
  density = "comfortable",
  emptyState,
  emptyText,
  error,
  exportOptions,
  filteredEmptyState,
  getRowKey,
  hasActiveFilters = false,
  hideTitle = false,
  loading = false,
  rowClassName,
  rows,
  selection,
  summary,
  tableCaption,
  tableDescription,
  title,
  ...props
}: CrudPageProps<TRow>) {
  const resolvedEmptyState = hasActiveFilters
    ? filteredEmptyState ?? (
        <p className="uh-crud-page__empty" role="status">
          Arama veya filtrelerle eşleşen kayıt bulunamadı.
        </p>
      )
    : emptyState;
  // Arama, filtre veya sayfa değişince sorgu anahtarı değişir ve satırlar bir an boş gelir; tablo çökmesin diye
  // yeni yanıt gelene kadar son başarılı satırlar aria-busy altında gösterilir.
  const lastLoadedRowsRef = useRef<TRow[]>([]);
  useEffect(() => {
    if (!loading && !error) lastLoadedRowsRef.current = rows;
  }, [error, loading, rows]);
  // Yükleme sürerken (liste ya da referans sorgusu) yarım çözülmüş satırlar gösterilmez; son tam yüklenen satırlar kalır.
  const tableRows = loading ? lastLoadedRowsRef.current : rows;
  const shouldRenderEmptyState = !loading && !error && rows.length === 0 && resolvedEmptyState;
  const shouldRenderTable = loading || (!error && !shouldRenderEmptyState);
  const tableShellRef = useRef<HTMLDivElement>(null);
  const [exportState, setExportState] = useState<{ message: string; status: "error" | "idle" | "pending" | "success" }>({ message: "", status: "idle" });
  const canExport = Boolean(exportOptions) && !loading && !error && rows.length > 0;

  async function handleExport() {
    const table = tableShellRef.current?.querySelector<HTMLTableElement>("table");
    if (!exportOptions || !table || exportState.status === "pending") return;
    const snapshot = readDataTableSnapshot(table, exportOptions);
    if (snapshot.rows.length === 0) return;
    setExportState({ message: "", status: "pending" });
    try {
      await exportOptions.onExport(snapshot);
      setExportState({ message: `${snapshot.rows.length.toLocaleString("tr-TR")} satır CSV olarak indirildi.`, status: "success" });
    } catch {
      setExportState({ message: exportOptions.errorMessage ?? "Dışa aktarma tamamlanamadı; dosya oluşturulmadı. Lütfen yeniden deneyin.", status: "error" });
    }
  }

  return (
    <section {...props} className={classNames("uh-crud-page", className)}>
      {title || description || actions ? (
        <header className="uh-crud-page__header">
          <div>
            {title ? <h2 className={hideTitle ? "uh-visually-hidden" : undefined}>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="uh-crud-page__actions">{actions}</div> : null}
        </header>
      ) : null}
      {!loading && error ? (
        <Alert className="uh-crud-page__error" tone="danger">
          {error}
        </Alert>
      ) : null}
      {exportOptions && shouldRenderTable ? (
        <div className="uh-crud-page__table-tools">
          <Tooltip label={exportOptions.hint ?? "Yalnız bu sayfada görünen satırlar ve sütunlar, ekrandaki maskeli biçimiyle indirilir."}>
            <Button
              disabled={!canExport}
              loading={exportState.status === "pending"}
              loadingLabel="Dışa aktarılıyor"
              onClick={() => void handleExport()}
              size="sm"
              variant="secondary"
            >
              {exportOptions.label ?? "CSV indir"}
            </Button>
          </Tooltip>
          {exportState.status === "error" ? (
            <p className="uh-crud-page__error" role="alert">{exportState.message}</p>
          ) : (
            <p className="uh-crud-page__success" role="status">{exportState.status === "success" ? exportState.message : ""}</p>
          )}
        </div>
      ) : null}
      {shouldRenderEmptyState ? (
        resolvedEmptyState
      ) : shouldRenderTable ? (
        <div className="uh-crud-page__table-shell" ref={tableShellRef}>
          <DataTable<TRow>
            caption={tableCaption}
            columns={columns}
            density={density}
            description={tableDescription}
            emptyText={emptyText}
            getRowKey={getRowKey}
            loading={loading}
            rowClassName={rowClassName}
            rows={tableRows}
            {...selection}
          />
        </div>
      ) : null}
      {summary ? <div className="uh-crud-page__summary">{summary}</div> : null}
    </section>
  );
}
