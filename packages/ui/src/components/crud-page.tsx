import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";
import { DataTable, type DataTableColumn } from "./data-table.js";
import { LoadingState } from "./loading-state.js";

export interface CrudPageProps<TRow> extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  columns: Array<DataTableColumn<TRow>>;
  description?: ReactNode;
  emptyState?: ReactNode;
  emptyText?: ReactNode;
  error?: ReactNode;
  getRowKey(row: TRow): string;
  loading?: boolean;
  rows: TRow[];
  title: ReactNode;
}

export function CrudPage<TRow>({
  actions,
  className,
  columns,
  description,
  emptyState,
  emptyText,
  error,
  getRowKey,
  loading = false,
  rows,
  title,
  ...props
}: CrudPageProps<TRow>) {
  return (
    <section {...props} className={classNames("uh-crud-page", className)}>
      <header className="uh-crud-page__header">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="uh-crud-page__actions">{actions}</div> : null}
      </header>
      {error ? <p className="uh-crud-page__error">{error}</p> : null}
      {loading && rows.length === 0 ? (
        <LoadingState />
      ) : rows.length === 0 && emptyState ? (
        emptyState
      ) : (
        <DataTable<TRow> columns={columns} emptyText={emptyText} getRowKey={getRowKey} rows={rows} />
      )}
    </section>
  );
}
