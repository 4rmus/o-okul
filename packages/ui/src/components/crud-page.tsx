import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";
import { Alert } from "./alert.js";
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
  filteredEmptyState?: ReactNode;
  getRowKey(row: TRow): string;
  hasActiveFilters?: boolean;
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
  filteredEmptyState,
  getRowKey,
  hasActiveFilters = false,
  loading = false,
  rowClassName,
  rows,
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
  const shouldRenderEmptyState = !loading && !error && rows.length === 0 && resolvedEmptyState;
  const shouldRenderTable = loading || (!error && !shouldRenderEmptyState);

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
      {!loading && error ? (
        <Alert className="uh-crud-page__error" tone="danger">
          {error}
        </Alert>
      ) : null}
      {shouldRenderEmptyState ? (
        resolvedEmptyState
      ) : shouldRenderTable ? (
        <div className="uh-crud-page__table-shell">
          <DataTable<TRow>
            caption={tableCaption}
            columns={columns}
            density={density}
            description={tableDescription}
            emptyText={emptyText}
            getRowKey={getRowKey}
            loading={loading}
            rowClassName={rowClassName}
            rows={loading ? [] : rows}
          />
        </div>
      ) : null}
    </section>
  );
}
