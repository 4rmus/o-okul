import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface DataTableColumn<TRow> {
  key: string;
  header: ReactNode;
  render(row: TRow): ReactNode;
}

export interface DataTableProps<TRow> extends HTMLAttributes<HTMLTableElement> {
  columns: Array<DataTableColumn<TRow>>;
  emptyText?: ReactNode;
  getRowKey(row: TRow): string;
  rows: TRow[];
}

export function DataTable<TRow>({
  className,
  columns,
  emptyText = "Kayıt yok",
  getRowKey,
  rows,
  ...props
}: DataTableProps<TRow>) {
  return (
    <table {...props} className={classNames("uh-data-table", className)}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={columns.length}>{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
