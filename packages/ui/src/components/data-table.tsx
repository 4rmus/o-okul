import { Fragment, type HTMLAttributes, type ReactNode, useId } from "react";
import { classNames } from "../class-names.js";

export type DataTableSortDirection = "ascending" | "descending";

export interface DataTableColumn<TRow> {
  align?: "left" | "center" | "right";
  key: string;
  header: ReactNode;
  mobileLabel?: string;
  mobilePriority?: "hidden" | "primary" | "secondary";
  priority?: "primary" | "secondary" | "optional";
  render(row: TRow): ReactNode;
  /**
   * Başlık tıklanınca istenen yeni yönle çağrılır; verildiğinde başlık bir sıralama düğmesi taşır (UI/UX F12).
   * Sayfa bunu liste kontrollerindeki "Sırala" seçimiyle aynı URL sıralama durumuna bağlar.
   * Yalnız metin (string/number) başlıkta etkindir: düğmenin erişilebilir adı görünen başlık metniyle aynı olmalıdır
   * (WCAG 2.5.3). Zengin (ReactNode) başlıkta sıralama düğmesi çizilmez; sıralama "Sırala" seçiminde kalır.
   */
  onSort?(direction: DataTableSortDirection): void;
  /** Etkin sıralama yönü; sütun başlığına aria-sort olarak yansır. */
  sortDirection?: DataTableSortDirection;
  sticky?: boolean | "left" | "right";
}

/**
 * Satır seçimi (S3). `onSelectionChange` verildiğinde tablo ilk sütunda satır onay kutuları ve başlıkta
 * "sayfadaki tümünü seç" kutusu çizer. Anahtarlar `getRowKey` değerleridir; başlık kutusu yalnız görünen
 * satırları ekler veya çıkarır, listede olmayan anahtarlara dokunmaz.
 */
export interface DataTableSelectionOptions<TRow> {
  /** Satır kutusunun erişilebilir adı "<etiket> seç" olur; verilmezse "Satır N seç". */
  getRowLabel?(row: TRow): string;
  onSelectionChange(keys: string[]): void;
  /** Başlık kutusunun erişilebilir adı. */
  selectAllLabel?: string;
  selectedKeys: readonly string[];
}

export interface DataTableProps<TRow> extends HTMLAttributes<HTMLTableElement> {
  caption?: ReactNode;
  columns: Array<DataTableColumn<TRow>>;
  density?: "comfortable" | "compact";
  description?: ReactNode;
  error?: ReactNode;
  emptyText?: ReactNode;
  getRowKey(row: TRow): string;
  loading?: boolean;
  rows: TRow[];
  rowClassName?(row: TRow): string | undefined;
  getRowLabel?(row: TRow): string;
  onSelectionChange?(keys: string[]): void;
  selectAllLabel?: string;
  selectedKeys?: readonly string[];
  /** Başlık satırını kaydırma alanında sabitler; geniş ekranda alan yüksekliği sınırlanır. Seçim açıkken varsayılan açıktır. */
  stickyHeader?: boolean;
}

export function DataTable<TRow>({
  caption,
  className,
  columns,
  density = "comfortable",
  description,
  error,
  emptyText = "Kayıt yok",
  getRowKey,
  loading = false,
  rows,
  rowClassName,
  getRowLabel,
  onSelectionChange,
  selectAllLabel,
  selectedKeys,
  stickyHeader,
  ...props
}: DataTableProps<TRow>) {
  const selection: DataTableSelectionOptions<TRow> | null = onSelectionChange
    ? { getRowLabel, onSelectionChange, selectAllLabel, selectedKeys: selectedKeys ?? [] }
    : null;
  const selectedKeySet = new Set(selection?.selectedKeys ?? []);
  const pageRowKeys = selection ? rows.map(getRowKey) : [];
  const selectedPageRowCount = pageRowKeys.filter((key) => selectedKeySet.has(key)).length;
  const allPageRowsSelected = pageRowKeys.length > 0 && selectedPageRowCount === pageRowKeys.length;
  const somePageRowsSelected = selectedPageRowCount > 0 && !allPageRowsSelected;
  // Seçim açıkken başlık satırı varsayılan olarak sabittir; stickyHeader ile ayrıca açılıp kapatılabilir.
  const isStickyHeader = stickyHeader ?? Boolean(selection);
  const emptyColSpan = Math.max(columns.length + (selection ? 1 : 0), 1);
  const state = error ? "error" : loading && rows.length === 0 ? "loading" : rows.length === 0 ? "empty" : undefined;
  const mobileDetailColumns = columns.filter(shouldRenderMobileDetailColumn);
  const scrollRegionLabel = resolveScrollRegionLabel(caption, props["aria-label"]);
  const sortHintId = useId();
  const hasSortableColumn = columns.some((column) => column.onSort && resolveCellLabel(column.header));

  return (
    <div
      aria-label={scrollRegionLabel}
      className="uh-data-table-scroll"
      data-sticky-header={isStickyHeader ? "true" : undefined}
      role="region"
      tabIndex={0}
    >
      <table
        {...props}
        aria-busy={loading || props["aria-busy"] || undefined}
        className={classNames("uh-data-table", density === "compact" && "uh-data-table--compact", className)}
      >
        {caption || description ? (
          <caption>
            {caption ? <span className="uh-data-table__caption-title">{caption}</span> : null}
            {description ? <span className="uh-data-table__caption-description">{description}</span> : null}
          </caption>
        ) : null}
        <thead>
          <tr>
            {selection ? (
              <th className="uh-data-table__select-cell" data-column-key={selectColumnKey} scope="col">
                <label className="uh-data-table__select">
                  <input
                    aria-label={selection.selectAllLabel ?? "Sayfadaki tüm satırları seç"}
                    checked={allPageRowsSelected}
                    className="uh-checkbox__input"
                    disabled={pageRowKeys.length === 0}
                    onChange={(event) => selection.onSelectionChange(
                      event.target.checked
                        ? [...selection.selectedKeys, ...pageRowKeys.filter((key) => !selectedKeySet.has(key))]
                        : selection.selectedKeys.filter((key) => !pageRowKeys.includes(key)),
                    )}
                    ref={(input) => {
                      if (input) input.indeterminate = somePageRowsSelected;
                    }}
                    type="checkbox"
                  />
                </label>
              </th>
            ) : null}
            {columns.map((column) => {
              // Ad görünen başlık metninden gelir; mobileLabel veya genel "Detay" yedeği sütun adını ezmez.
              const sortLabel = column.onSort ? resolveCellLabel(column.header) : undefined;
              return (
                <th
                  aria-label={sortLabel}
                  aria-sort={column.sortDirection}
                  data-align={column.align}
                  data-column-key={column.key}
                  data-mobile-priority={column.mobilePriority}
                  data-priority={column.priority}
                  data-sortable={sortLabel ? "true" : undefined}
                  data-sticky={resolveStickySide(column.sticky)}
                  key={column.key}
                  scope="col"
                >
                  {column.header}
                  {sortLabel ? (
                    <button
                      aria-describedby={sortHintId}
                      aria-label={sortLabel}
                      className="uh-data-table__sort-button"
                      onClick={() => column.onSort?.(resolveNextSortDirection(column.sortDirection))}
                      type="button"
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {state ? (
            <tr data-state={state}>
              <td className="uh-data-table__state" colSpan={emptyColSpan} role={state === "error" ? "alert" : state === "loading" ? "status" : undefined}>
                {state === "error" ? error : state === "loading" ? "Yükleniyor…" : emptyText}
              </td>
            </tr>
          ) : rows.length > 0 ? (
            rows.map((row, rowIndex) => {
              const rowKey = getRowKey(row);
              const isSelected = selection ? selectedKeySet.has(rowKey) : false;
              return (
                <Fragment key={rowKey}>
                  <tr className={rowClassName?.(row)} data-selected={isSelected ? "true" : undefined}>
                    {selection ? (
                      <td className="uh-data-table__select-cell" data-column-key={selectColumnKey}>
                        <label className="uh-data-table__select">
                          <input
                            aria-label={`${selection.getRowLabel?.(row) ?? `Satır ${rowIndex + 1}`} seç`}
                            checked={isSelected}
                            className="uh-checkbox__input"
                            onChange={(event) => selection.onSelectionChange(
                              event.target.checked
                                ? [...selection.selectedKeys.filter((key) => key !== rowKey), rowKey]
                                : selection.selectedKeys.filter((key) => key !== rowKey),
                            )}
                            type="checkbox"
                          />
                        </label>
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const cellLabel = column.mobileLabel ?? resolveCellLabel(column.header);
                      return (
                        <td
                          data-align={column.align}
                          data-column-key={column.key}
                          data-label={cellLabel}
                          data-mobile-priority={column.mobilePriority}
                          data-priority={column.priority}
                          data-sticky={resolveStickySide(column.sticky)}
                          key={column.key}
                        >
                          {column.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                  {mobileDetailColumns.length > 0 ? (
                    <tr className="uh-data-table__mobile-detail-row" data-mobile-detail="true" data-selected={isSelected ? "true" : undefined}>
                      <td className="uh-data-table__mobile-detail" colSpan={emptyColSpan}>
                        <dl className="uh-data-table__mobile-detail-list">
                          {mobileDetailColumns.map((column) => (
                            <div className="uh-data-table__mobile-detail-item" key={`${rowKey}:${column.key}`}>
                              <dt>{resolveMobileDetailLabel(column)}</dt>
                              <dd>{column.render(row)}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          ) : null}
        </tbody>
      </table>
      {hasSortableColumn ? (
        <span hidden id={sortHintId}>
          Bu sütuna göre sırala; her basışta artan ve azalan arasında geçer.
        </span>
      ) : null}
    </div>
  );
}

const selectColumnKey = "__select";

/** İki durumlu geçiş: artan → azalan → artan. Varsayılan sıraya dönüş "Sırala" seçiminden yapılır. */
function resolveNextSortDirection(current: DataTableSortDirection | undefined): DataTableSortDirection {
  return current === "ascending" ? "descending" : "ascending";
}

function resolveScrollRegionLabel(caption: ReactNode, ariaLabel: string | undefined) {
  if (ariaLabel?.trim()) return `${ariaLabel} kaydırma alanı`;
  if (typeof caption === "string" || typeof caption === "number") return `${String(caption)} kaydırma alanı`;
  return "Veri tablosu";
}

function shouldRenderMobileDetailColumn<TRow>(column: DataTableColumn<TRow>) {
  if (column.key === "actions") return false;
  return column.mobilePriority === "hidden" || column.priority === "optional";
}

function resolveMobileDetailLabel<TRow>(column: DataTableColumn<TRow>) {
  return column.mobileLabel ?? resolveCellLabel(column.header) ?? "Detay";
}

function resolveCellLabel(header: ReactNode) {
  if (typeof header === "string" || typeof header === "number") return String(header);
  return undefined;
}

function resolveStickySide(sticky: boolean | "left" | "right" | undefined) {
  if (sticky === true) return "left";
  return sticky || undefined;
}
