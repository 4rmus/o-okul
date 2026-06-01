import {
  createElement,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Doughnut, Line, Radar } from "react-chartjs-2";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
  Legend,
);

export const uiPackageName = "Uzman Hocam UI";

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, size = "md", type = "button", variant = "primary", ...props }: ButtonProps) {
  return createElement("button", {
    ...props,
    className: classNames("uh-button", `uh-button--${variant}`, `uh-button--${size}`, className),
    type,
  });
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return createElement("input", {
    ...props,
    "aria-invalid": invalid || props["aria-invalid"] || undefined,
    className: classNames("uh-input", invalid && "uh-input--invalid", className),
  });
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return createElement("table", {
    ...props,
    className: classNames("uh-table", className),
  });
}

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onClose?(): void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ children, className, description, footer, onClose, open, title, ...props }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusable = panel ? panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) : null;
    const firstFocusable = focusable && focusable.length > 0 ? focusable[0] : null;
    (firstFocusable ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createElement(
    "div",
    {
      ...props,
      "aria-describedby": description ? descriptionId : undefined,
      "aria-labelledby": titleId,
      "aria-modal": true,
      className: classNames("uh-dialog", className),
      role: "dialog",
    },
    createElement(
      "div",
      { className: "uh-dialog__panel", ref: panelRef, tabIndex: -1 },
      createElement("h2", { className: "uh-dialog__title", id: titleId }, title),
      description
        ? createElement("p", { className: "uh-dialog__description", id: descriptionId }, description)
        : null,
      createElement("div", { className: "uh-dialog__body" }, children),
      footer ? createElement("div", { className: "uh-dialog__footer" }, footer) : null,
    ),
  );
}

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: ToastTone;
  title?: ReactNode;
}

export function Toast({ children, className, title, tone = "info", ...props }: ToastProps) {
  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-toast", `uh-toast--${tone}`, className),
      role: props.role ?? "status",
    },
    title ? createElement("strong", { className: "uh-toast__title" }, title) : null,
    children ? createElement("div", { className: "uh-toast__body" }, children) : null,
  );
}

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
}

export function LoadingState({ className, label = "Yükleniyor…", ...props }: LoadingStateProps) {
  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-loading-state", className),
      role: "status",
    },
    createElement("span", { "aria-hidden": true, className: "uh-spinner" }),
    createElement("span", { className: "uh-loading-state__label" }, label),
  );
}

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
  return createElement(
    "table",
    {
      ...props,
      className: classNames("uh-data-table", className),
    },
    createElement(
      "thead",
      null,
      createElement(
        "tr",
        null,
        ...columns.map((column) => createElement("th", { key: column.key, scope: "col" }, column.header)),
      ),
    ),
    createElement(
      "tbody",
      null,
      rows.length > 0
        ? rows.map((row) =>
            createElement(
              "tr",
              { key: getRowKey(row) },
              ...columns.map((column) => createElement("td", { key: column.key }, column.render(row))),
            ),
          )
        : createElement(
            "tr",
            null,
            createElement("td", { colSpan: columns.length }, emptyText),
          ),
    ),
  );
}

export interface CrudPageProps<TRow> extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  columns: Array<DataTableColumn<TRow>>;
  description?: ReactNode;
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
  emptyText,
  error,
  getRowKey,
  loading = false,
  rows,
  title,
  ...props
}: CrudPageProps<TRow>) {
  return createElement(
    "section",
    {
      ...props,
      className: classNames("uh-crud-page", className),
    },
    createElement(
      "header",
      { className: "uh-crud-page__header" },
      createElement(
        "div",
        null,
        createElement("h1", null, title),
        description ? createElement("p", null, description) : null,
      ),
      actions ? createElement("div", { className: "uh-crud-page__actions" }, actions) : null,
    ),
    error ? createElement("p", { className: "uh-crud-page__error" }, error) : null,
    loading && rows.length === 0
      ? createElement(LoadingState, null)
      : createElement(DataTable<TRow>, { columns, emptyText, getRowKey, rows }),
  );
}

export interface FormModalProps extends Omit<DialogProps, "footer" | "onSubmit"> {
  cancelLabel?: ReactNode;
  children: ReactNode;
  submitLabel?: ReactNode;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function FormModal({
  cancelLabel = "Vazgeç",
  children,
  onCancel,
  onSubmit,
  submitLabel = "Kaydet",
  ...props
}: FormModalProps) {
  return createElement(
    Dialog,
    {
      ...props,
      onClose: onCancel,
      footer: createElement(
        "div",
        { className: "uh-form-modal__footer" },
        createElement(Button, { onClick: onCancel, type: "button", variant: "secondary" }, cancelLabel),
        createElement(Button, { type: "submit", form: "uh-form-modal-form" }, submitLabel),
      ),
    },
    createElement(
      "form",
      { className: "uh-form-modal__form", id: "uh-form-modal-form", onSubmit },
      children,
    ),
  );
}

export interface ExamResultDonutInput {
  correct?: number;
  wrong?: number;
  blank?: number;
}

export interface ExamResultDonutProps extends HTMLAttributes<HTMLDivElement> {
  result: ExamResultDonutInput;
}

export function ExamResultDonut({ className, result, ...props }: ExamResultDonutProps) {
  const correct = result.correct ?? 0;
  const wrong = result.wrong ?? 0;
  const blank = result.blank ?? 0;
  const total = correct + wrong + blank;
  const data: ChartData<"doughnut", number[], string> = {
    labels: ["Doğru", "Yanlış", "Boş"],
    datasets: [
      {
        data: [correct, wrong, blank],
        backgroundColor: ["#15803d", "#b42318", "#667085"],
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };
  const options: ChartOptions<"doughnut"> = {
    cutout: "62%",
    plugins: {
      legend: {
        position: "bottom",
      },
      tooltip: {
        enabled: true,
      },
    },
    responsive: true,
  };

  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-exam-result-donut", className),
    },
    createElement(Doughnut, { data, options }),
    createElement(
      "table",
      { className: "uh-chart-table" },
      createElement(
        "caption",
        null,
        total > 0 ? `Toplam ${total} soru` : "Sonuç verisi yok",
      ),
      createElement(
        "tbody",
        null,
        createElement("tr", null, createElement("th", { scope: "row" }, "Doğru"), createElement("td", null, correct)),
        createElement("tr", null, createElement("th", { scope: "row" }, "Yanlış"), createElement("td", null, wrong)),
        createElement("tr", null, createElement("th", { scope: "row" }, "Boş"), createElement("td", null, blank)),
      ),
    ),
  );
}

export interface ClassCompareBarInput {
  classId?: string | null;
  className?: string | null;
  net?: number;
  standardScore?: number;
}

export interface ClassCompareBarProps extends HTMLAttributes<HTMLDivElement> {
  classes: ClassCompareBarInput[];
}

export function ClassCompareBar({ className, classes, ...props }: ClassCompareBarProps) {
  const rows = classes.map((record) => ({
    id: record.classId ?? record.className ?? "no-class",
    name: record.className ?? "Sınıfsız",
    net: record.net ?? 0,
    standardScore: record.standardScore ?? 0,
  }));
  const data: ChartData<"bar", number[], string> = {
    labels: rows.map((record) => record.name),
    datasets: [
      {
        label: "Net",
        data: rows.map((record) => record.net),
        backgroundColor: "#155eef",
        borderRadius: 4,
      },
    ],
  };
  const options: ChartOptions<"bar"> = {
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
      },
    },
    responsive: true,
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-class-compare-bar", className),
    },
    createElement(Bar, { data, options }),
    createElement(
      "table",
      { className: "uh-chart-table" },
      createElement("caption", null, rows.length > 0 ? "Sınıf net karşılaştırması" : "Sınıf verisi yok"),
      createElement(
        "tbody",
        null,
        ...rows.map((record) =>
          createElement(
            "tr",
            { key: record.id },
            createElement("th", { scope: "row" }, record.name),
            createElement("td", null, record.net),
          ),
        ),
      ),
    ),
  );
}

export interface ProgressLineChartPoint {
  snapshotId?: string;
  generatedAt?: string;
  total: {
    net?: number;
    standardScore?: number;
  };
}

export interface ProgressLineChartProps extends HTMLAttributes<HTMLDivElement> {
  points: ProgressLineChartPoint[];
}

export function ProgressLineChart({ className, points, ...props }: ProgressLineChartProps) {
  const rows = points.map((point, index) => ({
    id: point.snapshotId ?? point.generatedAt ?? String(index),
    label: point.generatedAt ? new Date(point.generatedAt).toLocaleDateString("tr-TR") : `Ölçüm ${index + 1}`,
    net: point.total.net ?? 0,
    standardScore: point.total.standardScore ?? 0,
  }));
  const data: ChartData<"line", number[], string> = {
    labels: rows.map((point) => point.label),
    datasets: [
      {
        label: "Net",
        data: rows.map((point) => point.net),
        borderColor: "#155eef",
        backgroundColor: "rgba(21, 94, 239, 0.16)",
        pointBackgroundColor: "#155eef",
        tension: 0.3,
      },
    ],
  };
  const options: ChartOptions<"line"> = {
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
      },
    },
    responsive: true,
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-progress-line-chart", className),
    },
    createElement(Line, { data, options }),
    createElement(
      "table",
      { className: "uh-chart-table" },
      createElement("caption", null, rows.length > 0 ? "Öğrenci gelişim grafiği" : "Gelişim verisi yok"),
      createElement(
        "tbody",
        null,
        ...rows.map((point) =>
          createElement(
            "tr",
            { key: point.id },
            createElement("th", { scope: "row" }, point.label),
            createElement("td", null, point.net),
            createElement("td", null, point.standardScore),
          ),
        ),
      ),
    ),
  );
}

export interface TopicRadarChartInput {
  branch: string;
  net?: number;
  resultCount?: number;
}

export interface TopicRadarChartProps extends HTMLAttributes<HTMLDivElement> {
  branches: TopicRadarChartInput[];
}

export function TopicRadarChart({ branches, className, ...props }: TopicRadarChartProps) {
  const rows = branches.map((branch) => ({
    name: branch.branch,
    net: branch.net ?? 0,
    resultCount: branch.resultCount ?? 0,
  }));
  const data: ChartData<"radar", number[], string> = {
    labels: rows.map((branch) => branch.name),
    datasets: [
      {
        label: "Net",
        data: rows.map((branch) => branch.net),
        backgroundColor: "rgba(21, 94, 239, 0.16)",
        borderColor: "#155eef",
        pointBackgroundColor: "#155eef",
      },
    ],
  };
  const options: ChartOptions<"radar"> = {
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
      },
    },
    responsive: true,
    scales: {
      r: {
        beginAtZero: true,
      },
    },
  };

  return createElement(
    "div",
    {
      ...props,
      className: classNames("uh-topic-radar-chart", className),
    },
    createElement(Radar, { data, options }),
    createElement(
      "table",
      { className: "uh-chart-table" },
      createElement("caption", null, rows.length > 0 ? "Branş net analizi" : "Branş verisi yok"),
      createElement(
        "tbody",
        null,
        ...rows.map((branch) =>
          createElement(
            "tr",
            { key: branch.name },
            createElement("th", { scope: "row" }, branch.name),
            createElement("td", null, branch.net),
            createElement("td", null, branch.resultCount),
          ),
        ),
      ),
    ),
  );
}
