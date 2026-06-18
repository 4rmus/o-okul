import type { HTMLAttributes, ReactNode } from "react";
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

  return (
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
          rows.map((row) => (
            <tr className={rowClassName?.(row)} key={getRowKey(row)}>
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
          ))
        ) : null}
      </tbody>
    </table>
  );
}

function resolveCellLabel(header: ReactNode) {
  if (typeof header === "string" || typeof header === "number") return String(header);
  return undefined;
}

function resolveStickySide(sticky: boolean | "left" | "right" | undefined) {
  if (sticky === true) return "left";
  return sticky || undefined;
}
