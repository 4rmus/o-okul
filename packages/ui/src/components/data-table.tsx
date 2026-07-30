import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface DataTableColumn<TRow> {
  align?: "left" | "center" | "right";
  key: string;
  header: ReactNode;
  mobileLabel?: string;
  mobilePriority?: "hidden" | "primary" | "secondary";
  priority?: "primary" | "secondary" | "optional";
  render(row: TRow): ReactNode;
  sticky?: boolean | "left" | "right";
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
  ...props
}: DataTableProps<TRow>) {
  const emptyColSpan = Math.max(columns.length, 1);
  const state = error ? "error" : loading && rows.length === 0 ? "loading" : rows.length === 0 ? "empty" : undefined;
  const mobileDetailColumns = columns.filter(shouldRenderMobileDetailColumn);
  const scrollRegionLabel = resolveScrollRegionLabel(caption, props["aria-label"]);

  return (
    <div aria-label={scrollRegionLabel} className="uh-data-table-scroll" role="region" tabIndex={0}>
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
            {columns.map((column) => (
              <th
                data-align={column.align}
                data-column-key={column.key}
                data-mobile-priority={column.mobilePriority}
                data-priority={column.priority}
                data-sticky={resolveStickySide(column.sticky)}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
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
            rows.map((row) => {
              const rowKey = getRowKey(row);
              return (
                <Fragment key={rowKey}>
                  <tr className={rowClassName?.(row)}>
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
                    <tr className="uh-data-table__mobile-detail-row" data-mobile-detail="true">
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
    </div>
  );
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
