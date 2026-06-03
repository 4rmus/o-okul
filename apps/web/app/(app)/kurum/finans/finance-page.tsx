"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  PaymentInstallmentRecord,
  PaymentInstallmentStatus,
  PaymentPlanWithInstallmentsRecord,
  StudentRecord,
} from "@uzman-hocam/shared-types";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { CheckCircle2, Clock, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, type ListMeta } from "../../../../src/api-client.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

interface FinanceFilters {
  campusId: string;
  gradeLevelId: string;
  classId: string;
  courseId: string;
  termId: string;
  studentId: string;
}

interface InstallmentRow {
  id: string;
  plan: PaymentPlanWithInstallmentsRecord;
  installment: PaymentInstallmentRecord;
}

interface FinanceReferences {
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  gradeLevels: GradeLevelRecord[];
  students: StudentRecord[];
  terms: AcademicTermRecord[];
}

interface InstallmentForm {
  amount: string;
  dueDate: string;
  status: PaymentInstallmentStatus;
}

const emptyFilters: FinanceFilters = {
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
  studentId: "",
};

const emptyReferences: FinanceReferences = {
  campuses: [],
  classes: [],
  courses: [],
  gradeLevels: [],
  students: [],
  terms: [],
};

export function FinancePage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [listQuery, setListQuery] = useState<ListQueryState>({ ...initialListQuery, sort: "dueDate" });
  const [filters, setFilters] = useState<FinanceFilters>(emptyFilters);
  const [editingRow, setEditingRow] = useState<InstallmentRow | null>(null);
  const [form, setForm] = useState<InstallmentForm>({ amount: "", dueDate: "", status: "PENDING" });
  const [error, setError] = useState("");
  const listQueryKey = ["next-finance-payment-plans", tenantId];
  const plansQuery = useQuery({
    queryKey: ["next-finance-payment-plans", tenantId, listQuery, filters],
    queryFn: () => loadPaymentPlans(auth?.accessToken ?? "", listQuery, filters),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["next-finance-refs", tenantId],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const references = referencesQuery.data ?? emptyReferences;
  const plans = plansQuery.data?.data ?? [];
  const rows = useMemo(() => flattenInstallments(plans), [plans]);
  const meta = resolveInstallmentMeta(plansQuery.data?.meta, rows.length);
  const metrics = calculateMetrics(plans);
  const studentNameById = useMemo(
    () => new Map(references.students.map((student) => [student.id, `${student.firstName} ${student.lastName}`])),
    [references.students],
  );
  const campusNameById = useMemo(() => new Map(references.campuses.map((campus) => [campus.id, campus.name])), [references.campuses]);
  const gradeLevelNameById = useMemo(() => new Map(references.gradeLevels.map((level) => [level.id, level.name])), [references.gradeLevels]);
  const classNameById = useMemo(() => new Map(references.classes.map((klass) => [klass.id, klass.name])), [references.classes]);
  const courseNameById = useMemo(() => new Map(references.courses.map((course) => [course.id, course.name])), [references.courses]);
  const termNameById = useMemo(() => new Map(references.terms.map((term) => [term.id, term.name])), [references.terms]);

  const columns: Array<DataTableColumn<InstallmentRow>> = [
    {
      key: "student",
      header: "Öğrenci",
      render: (row) => studentNameById.get(row.plan.studentId) ?? row.plan.studentId,
    },
    {
      key: "plan",
      header: "Plan",
      render: (row) => row.plan.title,
    },
    {
      key: "context",
      header: "Bağlam",
      render: (row) => formatContext(row.plan, { campusNameById, classNameById, courseNameById, gradeLevelNameById, termNameById }),
    },
    {
      key: "installment",
      header: "Taksit",
      render: (row) => `${row.installment.installmentNo}. taksit`,
    },
    {
      key: "amount",
      header: "Tutar",
      render: (row) => formatMoney(row.installment.amount, row.plan.currency),
    },
    {
      key: "dueDate",
      header: "Vade",
      render: (row) => row.installment.dueDate,
    },
    {
      key: "status",
      header: "Durum",
      render: (row) => statusLabel(row.installment.status),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (row) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(row)} aria-label={`${row.plan.title} ${row.installment.installmentNo}. taksit düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void updateInstallmentStatus(row, "PAID")} aria-label={`${row.plan.title} ${row.installment.installmentNo}. taksit ödendi işaretle`}>
            <CheckCircle2 size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void updateInstallmentStatus(row, "OVERDUE")} aria-label={`${row.plan.title} ${row.installment.installmentNo}. taksit gecikmiş işaretle`}>
            <TriangleAlert size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void updateInstallmentStatus(row, "PENDING")} aria-label={`${row.plan.title} ${row.installment.installmentNo}. taksit beklemede işaretle`}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function updateFilters(nextFilters: FinanceFilters) {
    setFilters(nextFilters);
    setListQuery((current) => ({ ...current, page: 1 }));
  }

  function openEditForm(row: InstallmentRow) {
    setEditingRow(row);
    setForm({
      amount: formatAmountInput(row.installment.amount),
      dueDate: row.installment.dueDate,
      status: row.installment.status,
    });
    setError("");
  }

  function closeForm() {
    setEditingRow(null);
    setForm({ amount: "", dueDate: "", status: "PENDING" });
  }

  async function updateInstallmentStatus(row: InstallmentRow, status: PaymentInstallmentStatus) {
    if (!auth) return;
    setError("");
    try {
      await updateInstallment(auth.accessToken, row.plan.id, row.installment.id, { status });
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Taksit durumu güncellenemedi.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !editingRow) return;

    const amount = Number(form.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Tutar pozitif olmalıdır.");
      return;
    }

    setError("");
    try {
      await updateInstallment(auth.accessToken, editingRow.plan.id, editingRow.installment.id, {
        amount: Math.round(amount * 100),
        dueDate: form.dueDate,
        status: form.status,
      });
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Taksit kaydedilemedi.");
    }
  }

  return (
    <>
      <section className="next-dashboard-grid" aria-label="Finans özeti">
        <article className="next-metric">
          <span>Bekleyen ödeme</span>
          <strong>{formatMoney(metrics.pendingAmount, metrics.currency)}</strong>
        </article>
        <article className="next-metric">
          <span>Gecikmiş</span>
          <strong>{formatMoney(metrics.overdueAmount, metrics.currency)}</strong>
        </article>
        <article className="next-metric">
          <span>Ödenen</span>
          <strong>{formatMoney(metrics.paidAmount, metrics.currency)}</strong>
        </article>
      </section>
      <CrudPage
        actions={
          <>
            <FinanceFiltersPanel filters={filters} onChange={updateFilters} references={references} />
            <ListControls meta={meta} onChange={setListQuery} sortOptions={paymentSortOptions} state={listQuery} />
          </>
        }
        aria-label="Finans yönetimi"
        columns={columns}
        description="Ödeme planlarını öğrenci ve akademik bağlama göre izle, taksit durumlarını güncelle."
        emptyText="Ödeme taksiti yok"
        error={error || (plansQuery.isError ? "Ödeme planları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined)}
        getRowKey={(row) => row.id}
        loading={plansQuery.isPending || referencesQuery.isPending}
        rows={rows}
        title="Finans"
      />
      <InstallmentFormModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={Boolean(editingRow)}
      />
    </>
  );
}

function FinanceFiltersPanel({
  filters,
  onChange,
  references,
}: {
  filters: FinanceFilters;
  onChange(filters: FinanceFilters): void;
  references: FinanceReferences;
}) {
  return (
    <div className="next-list-controls" aria-label="Finans filtreleri">
      <label>
        Öğrenci
        <select value={filters.studentId} onChange={(event) => onChange({ ...filters, studentId: event.target.value })}>
          <option value="">Tümü</option>
          {references.students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kampüs
        <select value={filters.campusId} onChange={(event) => onChange({ ...filters, campusId: event.target.value })}>
          <option value="">Tümü</option>
          {references.campuses.map((campus) => (
            <option key={campus.id} value={campus.id}>{campus.name}</option>
          ))}
        </select>
      </label>
      <label>
        Seviye
        <select value={filters.gradeLevelId} onChange={(event) => onChange({ ...filters, gradeLevelId: event.target.value })}>
          <option value="">Tümü</option>
          {references.gradeLevels.map((level) => (
            <option key={level.id} value={level.id}>{level.name}</option>
          ))}
        </select>
      </label>
      <label>
        Sınıf
        <select value={filters.classId} onChange={(event) => onChange({ ...filters, classId: event.target.value })}>
          <option value="">Tümü</option>
          {references.classes.map((klass) => (
            <option key={klass.id} value={klass.id}>{klass.name}</option>
          ))}
        </select>
      </label>
      <label>
        Ders
        <select value={filters.courseId} onChange={(event) => onChange({ ...filters, courseId: event.target.value })}>
          <option value="">Tümü</option>
          {references.courses.map((course) => (
            <option key={course.id} value={course.id}>{course.name}</option>
          ))}
        </select>
      </label>
      <label>
        Dönem
        <select value={filters.termId} onChange={(event) => onChange({ ...filters, termId: event.target.value })}>
          <option value="">Tümü</option>
          {references.terms.map((term) => (
            <option key={term.id} value={term.id}>{term.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function InstallmentFormModal({
  form,
  onCancel,
  onChange,
  onSubmit,
  open,
}: {
  form: InstallmentForm;
  onCancel(): void;
  onChange(form: InstallmentForm): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
}) {
  return (
    <FormModal
      description="Tutar, vade ve durum alanlarını güncelle."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel="Kaydet"
      title="Taksit düzenle"
    >
      <label>
        Tutar
        <Input required inputMode="decimal" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} />
      </label>
      <label>
        Vade
        <Input required type="date" value={form.dueDate} onChange={(event) => onChange({ ...form, dueDate: event.target.value })} />
      </label>
      <label>
        Durum
        <select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as PaymentInstallmentStatus })}>
          <option value="PENDING">Beklemede</option>
          <option value="PAID">Ödendi</option>
          <option value="OVERDUE">Gecikmiş</option>
          <option value="CANCELED">İptal</option>
        </select>
      </label>
    </FormModal>
  );
}

const paymentSortOptions = [
  { label: "Vade eski-yeni", value: "dueDate" },
  { label: "Vade yeni-eski", value: "-dueDate" },
  { label: "Plan A-Z", value: "title" },
  { label: "Plan Z-A", value: "-title" },
];

async function loadPaymentPlans(accessToken: string, listQuery: ListQueryState, filters: FinanceFilters) {
  const url = new URL(buildListUrl(`${apiBaseUrl}/payment-plans`, listQuery));
  if (filters.studentId) url.searchParams.set("studentId", filters.studentId);
  if (filters.campusId) url.searchParams.set("campusId", filters.campusId);
  if (filters.gradeLevelId) url.searchParams.set("gradeLevelId", filters.gradeLevelId);
  if (filters.classId) url.searchParams.set("classId", filters.classId);
  if (filters.courseId) url.searchParams.set("courseId", filters.courseId);
  if (filters.termId) url.searchParams.set("termId", filters.termId);
  return apiListRequest<PaymentPlanWithInstallmentsRecord>(accessToken, url.toString());
}

async function loadReferences(accessToken: string): Promise<FinanceReferences> {
  const [campuses, classes, courses, gradeLevels, students, terms] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    campuses: campuses.data,
    classes: classes.data,
    courses: courses.data,
    gradeLevels: gradeLevels.data,
    students: students.data,
    terms: terms.data,
  };
}

async function updateInstallment(
  accessToken: string,
  planId: string,
  installmentId: string,
  input: Partial<Pick<PaymentInstallmentRecord, "amount" | "dueDate" | "status">>,
) {
  return apiRequest<PaymentPlanWithInstallmentsRecord>(
    accessToken,
    `${apiBaseUrl}/payment-plans/${encodeURIComponent(planId)}/installments/${encodeURIComponent(installmentId)}`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

function flattenInstallments(plans: PaymentPlanWithInstallmentsRecord[]): InstallmentRow[] {
  return plans.flatMap((plan) =>
    plan.installments.map((installment) => ({
      id: `${plan.id}-${installment.id}`,
      plan,
      installment,
    })),
  );
}

function calculateMetrics(plans: PaymentPlanWithInstallmentsRecord[]) {
  const installments = plans.flatMap((plan) => plan.installments);
  return {
    currency: plans[0]?.currency ?? "TRY",
    overdueAmount: sumAmounts(installments.filter((installment) => installment.status === "OVERDUE")),
    paidAmount: sumAmounts(installments.filter((installment) => installment.status === "PAID")),
    pendingAmount: sumAmounts(installments.filter((installment) => installment.status === "PENDING" || installment.status === "OVERDUE")),
  };
}

function sumAmounts(installments: PaymentInstallmentRecord[]) {
  return installments.reduce((total, installment) => total + installment.amount, 0);
}

function resolveInstallmentMeta(meta: ListMeta | undefined, rowCount: number): ListMeta {
  return meta ?? {
    limit: rowCount,
    page: 1,
    total: rowCount,
    totalPages: rowCount === 0 ? 0 : 1,
  };
}

function formatContext(
  plan: PaymentPlanWithInstallmentsRecord,
  maps: {
    campusNameById: Map<string, string>;
    classNameById: Map<string, string>;
    courseNameById: Map<string, string>;
    gradeLevelNameById: Map<string, string>;
    termNameById: Map<string, string>;
  },
) {
  const parts = [
    plan.campusId ? (maps.campusNameById.get(plan.campusId) ?? plan.campusId) : "",
    plan.gradeLevelId ? (maps.gradeLevelNameById.get(plan.gradeLevelId) ?? plan.gradeLevelId) : "",
    plan.classId ? (maps.classNameById.get(plan.classId) ?? plan.classId) : "",
    plan.courseId ? (maps.courseNameById.get(plan.courseId) ?? plan.courseId) : "",
    plan.termId ? (maps.termNameById.get(plan.termId) ?? plan.termId) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function statusLabel(status: PaymentInstallmentStatus) {
  const labels: Record<PaymentInstallmentStatus, string> = {
    CANCELED: "İptal",
    OVERDUE: "Gecikmiş",
    PAID: "Ödendi",
    PENDING: "Beklemede",
  };
  return labels[status];
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { currency, style: "currency" }).format(amount / 100);
}

function formatAmountInput(amount: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount / 100);
}
