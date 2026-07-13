import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";
import { DataTable, type DataTableColumn } from "./data-table.js";

type CrudPageDensity = "comfortable" | "compact";

export interface CrudPageProps<TRow> extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  columns: Array<DataTableColumn<TRow>>;
  description?: ReactNode;
  density?: CrudPageDensity;
  emptyState?: ReactNode;
  emptyText?: ReactNode;
  error?: ReactNode;
  getRowKey(row: TRow): string;
  loading?: boolean;
  rowClassName?(row: TRow): string | undefined;
  rows: TRow[];
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
  getRowKey,
  loading = false,
  rowClassName,
  rows,
  summary,
  tableCaption,
  tableDescription,
  title,
  ...props
}: CrudPageProps<TRow>) {
  const shouldRenderEmptyState = !error && !loading && rows.length === 0 && emptyState;

  return (
    <section {...props} className={classNames("uh-crud-page", className)}>
      {title || description || actions ? (
        <header className="uh-crud-page__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="uh-crud-page__actions">{actions}</div> : null}
        </header>
      ) : null}
      {summary ? <div className="uh-crud-page__summary">{summary}</div> : null}
      {error ? (
        <p className="uh-crud-page__error" role="alert">
          {error}
        </p>
      ) : null}
      {shouldRenderEmptyState ? (
        emptyState
      ) : (
        <div className="uh-crud-page__table-shell">
          <DataTable<TRow>
            caption={tableCaption}
            columns={columns}
            density={density}
            description={tableDescription}
            emptyText={emptyText}
            error={rows.length === 0 ? error : undefined}
            getRowKey={getRowKey}
            loading={loading}
            rowClassName={rowClassName}
            rows={rows}
          />
        </div>
      )}
    </section>
  );
}
