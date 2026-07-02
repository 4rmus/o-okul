"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  PaymentTransactionCreateRequest,
  PaymentTransactionMethod,
  PaymentTransactionRecord,
  StudentRecord,
} from "@o-okul/shared-types";
import { Button, CrudPage, DataTable, Dialog, EmptyState, Field, FilterBar, FormModal, Input, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import { Banknote, CheckCircle2, Pencil, Receipt, RotateCcw, TriangleAlert } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, type ListMeta } from "../../../../src/api-client.js";
import { buildListUrl, initialListQuery, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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

interface TransactionForm {
  amount: string;
  method: PaymentTransactionMethod;
  note: string;
  paidAt: string;
}

interface QueryParamReader {
  get(name: string): string | null;
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

const financeDefaultListQuery: ListQueryState = { ...initialListQuery, sort: "dueDate" };
const financeFilterKeys: Array<keyof FinanceFilters> = ["campusId", "gradeLevelId", "classId", "courseId", "termId", "studentId"];

export function FinancePage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const searchParamsKey = searchParams.toString();
  const [listQuery, setListQuery] = useUrlListState(searchParams, {
    defaultState: financeDefaultListQuery,
    sortOptions: paymentSortOptions,
  });
  const [filters, setFilters] = useState<FinanceFilters>(() => readFinanceFilters(searchParams));
  const [editingRow, setEditingRow] = useState<InstallmentRow | null>(null);
  const [collectingRow, setCollectingRow] = useState<InstallmentRow | null>(null);
  const [receiptRow, setReceiptRow] = useState<InstallmentRow | null>(null);
  const [form, setForm] = useState<InstallmentForm>({ amount: "", dueDate: "", status: "PENDING" });
  const [transactionForm, setTransactionForm] = useState<TransactionForm>({
    amount: "",
    method: "CASH",
    note: "",
    paidAt: defaultLocalDateTime(),
  });
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
  const transactionsQuery = useQuery({
    queryKey: ["next-finance-payment-transactions", tenantId, receiptRow?.plan.id],
    queryFn: () => loadPaymentTransactions(auth?.accessToken ?? "", receiptRow?.plan.id ?? ""),
    enabled: Boolean(auth && receiptRow),
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
  const courseNameById = useMemo(() => new Map(references.courses.map((course) => [course.id, formatCourseName(course.name)])), [references.courses]);
  const termNameById = useMemo(() => new Map(references.terms.map((term) => [term.id, term.name])), [references.terms]);
  const financeSummaryItems = buildFinanceSummaryItems(metrics, rows.length);
  const financeSummaryBadges = buildFinanceSummaryBadges(filters, listQuery);
  const financeSummaryActions = buildFinanceSummaryActions(metrics, filters);

  useEffect(() => {
    const nextFilters = readFinanceFilters(searchParams);
    setFilters((current) => (isSameFinanceFilters(current, nextFilters) ? current : nextFilters));
  }, [searchParams, searchParamsKey]);

  const columns: Array<DataTableColumn<InstallmentRow>> = [
    {
      key: "student",
      header: "Öğrenci",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => studentNameById.get(row.plan.studentId) ?? "Öğrenci kapsamı doğrulanmadı",
      sticky: true,
    },
    {
      key: "plan",
      header: "Plan",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (row) => row.plan.title,
    },
    {
      key: "context",
      header: "Bağlam",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatContext(row.plan, { campusNameById, classNameById, courseNameById, gradeLevelNameById, termNameById }),
    },
    {
      key: "installment",
      header: "Taksit",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (row) => `${row.installment.installmentNo}. taksit`,
    },
    {
      key: "amount",
      align: "right",
      header: "Tutar",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => formatMoney(row.installment.amount, row.plan.currency),
    },
    {
      key: "dueDate",
      header: "Vade",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (row) => row.installment.dueDate,
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <StatusBadge tone={statusTone(row.installment.status)}>
          {statusLabel(row.installment.status)}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobileLabel: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openTransactionForm(row)} aria-label={`${row.plan.title} ${row.installment.installmentNo}. taksit tahsilat kaydet`}>
            <Banknote size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setReceiptRow(row)} aria-label={`${row.plan.title} makbuzları görüntüle`}>
            <Receipt size={17} aria-hidden="true" />
          </button>
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
      sticky: "right",
    },
  ];

  function updateFilters(nextFilters: FinanceFilters) {
    setFilters(nextFilters);
    setListQuery({ ...listQuery, page: 1 });
    writeFinanceFiltersToUrl(nextFilters);
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

  function openTransactionForm(row: InstallmentRow) {
    setCollectingRow(row);
    setTransactionForm({
      amount: formatAmountInput(row.installment.amount),
      method: "CASH",
      note: "",
      paidAt: defaultLocalDateTime(),
    });
    setError("");
  }

  function closeTransactionForm() {
    setCollectingRow(null);
    setTransactionForm({ amount: "", method: "CASH", note: "", paidAt: defaultLocalDateTime() });
  }

  async function handleTransactionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !collectingRow) return;

    const amount = parseAmountInput(transactionForm.amount);
    if (!amount) {
      setError("Tahsilat tutarı pozitif olmalıdır.");
      return;
    }

    const paidAt = toIsoDateTime(transactionForm.paidAt);
    if (!paidAt) {
      setError("Tahsilat tarihi geçersiz.");
      return;
    }

    setError("");
    try {
      await createPaymentTransaction(
        auth.accessToken,
        collectingRow.plan.id,
        {
          amount,
          installmentId: collectingRow.installment.id,
          method: transactionForm.method,
          note: transactionForm.note.trim() || undefined,
          paidAt,
        },
      );
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-finance-payment-transactions", tenantId, collectingRow.plan.id] });
      setReceiptRow(collectingRow);
      closeTransactionForm();
    } catch {
      setError("Tahsilat kaydedilemedi.");
    }
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
        emptyState={
          <EmptyState
            title="Ödeme taksiti yok"
            description="Ödeme planları oluştuğunda bekleyen, geciken ve ödenen taksitler burada görünür."
            hint="Finans sinyalleri dashboard karar kartlarına da yansır."
          />
        }
        emptyText="Ödeme taksiti yok"
        error={error || (plansQuery.isError ? "Ödeme planları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined)}
        getRowKey={(row) => row.id}
        density="compact"
        loading={plansQuery.isPending || referencesQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={financeSummaryActions}
            ariaLabel="Finans operasyon özeti"
            badges={financeSummaryBadges}
            items={financeSummaryItems}
          />
        }
        tableCaption="Ödeme taksitleri"
        tableDescription="Bekleyen, geciken ve ödenen taksitler seçili akademik bağlama göre listelenir."
        title="Finans"
      />
      <InstallmentFormModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={Boolean(editingRow)}
      />
      <TransactionFormModal
        form={transactionForm}
        onCancel={closeTransactionForm}
        onChange={setTransactionForm}
        onSubmit={(event) => void handleTransactionSubmit(event)}
        open={Boolean(collectingRow)}
      />
      <ReceiptDialog
        installment={receiptRow?.installment}
        loading={transactionsQuery.isPending}
        onClose={() => setReceiptRow(null)}
        open={Boolean(receiptRow)}
        plan={receiptRow?.plan}
        studentName={receiptRow ? (studentNameById.get(receiptRow.plan.studentId) ?? "Öğrenci kapsamı doğrulanmadı") : ""}
        transactions={transactionsQuery.data ?? []}
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
    <FilterBar className="next-list-controls" role="group" aria-label="Finans filtreleri">
      <Field label="Öğrenci">
        <Select aria-label="Öğrenci" value={filters.studentId} onChange={(event) => onChange({ ...filters, studentId: event.target.value })}>
          <option value="">Tümü</option>
          {references.students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kampüs">
        <Select aria-label="Kampüs" value={filters.campusId} onChange={(event) => onChange({ ...filters, campusId: event.target.value })}>
          <option value="">Tümü</option>
          {references.campuses.map((campus) => (
            <option key={campus.id} value={campus.id}>
              {campus.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Seviye">
        <Select aria-label="Seviye" value={filters.gradeLevelId} onChange={(event) => onChange({ ...filters, gradeLevelId: event.target.value })}>
          <option value="">Tümü</option>
          {references.gradeLevels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sınıf">
        <Select aria-label="Sınıf" value={filters.classId} onChange={(event) => onChange({ ...filters, classId: event.target.value })}>
          <option value="">Tümü</option>
          {references.classes.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ders">
        <Select aria-label="Ders" value={filters.courseId} onChange={(event) => onChange({ ...filters, courseId: event.target.value })}>
          <option value="">Tümü</option>
          {references.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {formatCourseName(course.name)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Dönem">
        <Select aria-label="Dönem" value={filters.termId} onChange={(event) => onChange({ ...filters, termId: event.target.value })}>
          <option value="">Tümü</option>
          {references.terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </Select>
      </Field>
    </FilterBar>
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
      <Field label="Tutar">
        <Input required inputMode="decimal" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} />
      </Field>
      <Field label="Vade">
        <Input required type="date" value={form.dueDate} onChange={(event) => onChange({ ...form, dueDate: event.target.value })} />
      </Field>
      <Field label="Durum">
        <Select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as PaymentInstallmentStatus })}>
          <option value="PENDING">Beklemede</option>
          <option value="PAID">Ödendi</option>
          <option value="OVERDUE">Gecikmiş</option>
          <option value="CANCELED">İptal</option>
        </Select>
      </Field>
    </FormModal>
  );
}

function TransactionFormModal({
  form,
  onCancel,
  onChange,
  onSubmit,
  open,
}: {
  form: TransactionForm;
  onCancel(): void;
  onChange(form: TransactionForm): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
}) {
  return (
    <FormModal
      description="Tahsilat tutarı, yöntemi ve tarihi ile işlem kaydı oluştur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel="Tahsilatı kaydet"
      title="Tahsilat kaydet"
    >
      <Field label="Tutar">
        <Input required inputMode="decimal" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} />
      </Field>
      <Field label="Yöntem">
        <Select value={form.method} onChange={(event) => onChange({ ...form, method: event.target.value as PaymentTransactionMethod })}>
          <option value="CASH">Nakit</option>
          <option value="BANK_TRANSFER">Banka havalesi</option>
          <option value="CARD_POS">Kart POS</option>
          <option value="OTHER">Diğer</option>
        </Select>
      </Field>
      <Field label="Tarih">
        <Input required type="datetime-local" value={form.paidAt} onChange={(event) => onChange({ ...form, paidAt: event.target.value })} />
      </Field>
      <Field label="Not">
        <Input value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </Field>
    </FormModal>
  );
}

function ReceiptDialog({
  installment,
  loading,
  onClose,
  open,
  plan,
  studentName,
  transactions,
}: {
  installment?: PaymentInstallmentRecord;
  loading: boolean;
  onClose(): void;
  open: boolean;
  plan?: PaymentPlanWithInstallmentsRecord;
  studentName: string;
  transactions: PaymentTransactionRecord[];
}) {
  const relatedTransactions = installment
    ? transactions.filter((transaction) => transaction.installmentId === installment.id)
    : transactions;
  const columns: Array<DataTableColumn<PaymentTransactionRecord>> = [
    {
      header: "Makbuz",
      key: "receipt",
      priority: "primary",
      render: (transaction) => transaction.receiptNo,
      sticky: "left",
    },
    {
      align: "right",
      header: "Tutar",
      key: "amount",
      priority: "primary",
      render: (transaction) => formatMoney(transaction.amount, transaction.currency),
    },
    {
      header: "Yöntem",
      key: "method",
      priority: "secondary",
      render: (transaction) => transactionMethodLabel(transaction.method),
    },
    {
      header: "Tarih",
      key: "paidAt",
      priority: "secondary",
      render: (transaction) => formatDateTime(transaction.paidAt),
    },
    {
      header: "Durum",
      key: "status",
      priority: "secondary",
      render: (transaction) => (
        <StatusBadge tone={transaction.voidedAt ? "neutral" : "success"}>
          {transaction.voidedAt ? "İptal" : "Geçerli"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <Dialog
      description="Tahsilat işlemleri ve yazdırılabilir makbuz kayıtları."
      footer={
        <div className="uh-form-modal__footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button type="button" onClick={() => window.print()}>
            Yazdır
          </Button>
        </div>
      }
      onClose={onClose}
      open={open}
      title="Makbuzlar"
    >
      {loading ? <p>Makbuzlar yükleniyor.</p> : null}
      <DataTable
        caption="Tahsilat makbuzları"
        columns={columns}
        description="Seçili ödeme planına ait tahsilat işlemleri."
        emptyText="Makbuz yok."
        getRowKey={(transaction) => transaction.id}
        rows={relatedTransactions}
      />
      <div className="next-receipt-print-list" aria-label="Yazdırılabilir makbuzlar">
        {relatedTransactions.map((transaction) => (
          <article className="next-receipt-print-card" key={transaction.id}>
            <h3>Makbuz {transaction.receiptNo}</h3>
            <p>{studentName}</p>
            <p>{plan?.title ?? "-"}</p>
            <dl>
              <div>
                <dt>Tutar</dt>
                <dd>{formatMoney(transaction.amount, transaction.currency)}</dd>
              </div>
              <div>
                <dt>Yöntem</dt>
                <dd>{transactionMethodLabel(transaction.method)}</dd>
              </div>
              <div>
                <dt>Tarih</dt>
                <dd>{formatDateTime(transaction.paidAt)}</dd>
              </div>
              <div>
                <dt>Durum</dt>
                <dd>{transaction.voidedAt ? `İptal: ${transaction.voidReason ?? "-"}` : "Geçerli"}</dd>
              </div>
            </dl>
            {transaction.note ? <p>Not: {transaction.note}</p> : null}
          </article>
        ))}
      </div>
    </Dialog>
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

async function loadPaymentTransactions(accessToken: string, planId: string) {
  return apiListRequest<PaymentTransactionRecord>(
    accessToken,
    `${apiBaseUrl}/payment-plans/${encodeURIComponent(planId)}/transactions`,
  ).then((result) => result.data);
}

async function createPaymentTransaction(
  accessToken: string,
  planId: string,
  input: PaymentTransactionCreateRequest,
) {
  return apiRequest<PaymentTransactionRecord>(
    accessToken,
    `${apiBaseUrl}/payment-plans/${encodeURIComponent(planId)}/transactions`,
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "idempotency-key": createClientIdempotencyKey("payment-transaction"),
      },
      method: "POST",
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

function buildFinanceSummaryItems(metrics: ReturnType<typeof calculateMetrics>, rowCount: number): OperationSummaryItem[] {
  return [
    {
      description: "Bekleyen ve geciken toplam tahsilat",
      key: "pending",
      label: "Bekleyen ödeme",
      tone: metrics.pendingAmount > 0 ? "warning" : "success",
      value: formatMoney(metrics.pendingAmount, metrics.currency),
    },
    {
      description: "Öncelikli takip gerektiren toplam",
      key: "overdue",
      label: "Gecikmiş",
      tone: metrics.overdueAmount > 0 ? "danger" : "success",
      value: formatMoney(metrics.overdueAmount, metrics.currency),
    },
    {
      description: "Seçili kapsamda tahsil edildi",
      key: "paid",
      label: "Ödenen",
      tone: metrics.paidAmount > 0 ? "success" : "default",
      value: formatMoney(metrics.paidAmount, metrics.currency),
    },
    {
      description: "Liste yoğun görünümde izlenir",
      key: "rows",
      label: "Taksit satırı",
      value: formatCount(rowCount),
    },
  ];
}

function buildFinanceSummaryBadges(filters: FinanceFilters, listQuery: ListQueryState): OperationSummaryBadge[] {
  const filterCount = countActiveFinanceFilters(filters);
  return [
    {
      key: "scope",
      label: "Kurum finans görünümü",
      tone: "info",
    },
    {
      key: "filters",
      label: filterCount > 0 ? `${filterCount} filtre aktif` : "Tüm finans kapsamı",
      tone: filterCount > 0 ? "info" : "neutral",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatSortLabel(listQuery.sort)}`,
      tone: "neutral",
    },
  ];
}

function buildFinanceSummaryActions(metrics: ReturnType<typeof calculateMetrics>, filters: FinanceFilters): OperationSummaryAction[] {
  const filterCount = countActiveFinanceFilters(filters);
  return [
    {
      detail: "Gecikmiş taksitler öncelikli tahsilat listesinde kalır",
      key: "overdue-follow-up",
      label: "Geciken taksit",
      status: metrics.overdueAmount > 0 ? "Takip" : "Temiz",
      tone: metrics.overdueAmount > 0 ? "danger" : "success",
      value: formatMoney(metrics.overdueAmount, metrics.currency),
    },
    {
      detail: "Bekleyen ve geciken tahsilat birlikte izlenir",
      key: "pending-collection",
      label: "Bekleyen tahsilat",
      status: metrics.pendingAmount > 0 ? "Açık" : "Kapalı",
      tone: metrics.pendingAmount > 0 ? "warning" : "success",
      value: formatMoney(metrics.pendingAmount, metrics.currency),
    },
    {
      detail: filterCount > 0 ? "Öğrenci ve akademik bağlam filtreleri aktif" : "Kurum genel finans listesi",
      key: "reconciliation-scope",
      label: "Mutabakat kapsamı",
      status: filterCount > 0 ? "Odak" : "Genel",
      tone: filterCount > 0 ? "info" : "neutral",
      value: filterCount > 0 ? `${filterCount} filtre` : "Tüm kayıtlar",
    },
  ];
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
  const fallback = "Bağlam doğrulanmadı";
  const parts = [
    plan.campusId ? (maps.campusNameById.get(plan.campusId) ?? fallback) : "",
    plan.gradeLevelId ? (maps.gradeLevelNameById.get(plan.gradeLevelId) ?? fallback) : "",
    plan.classId ? (maps.classNameById.get(plan.classId) ?? fallback) : "",
    plan.courseId ? (maps.courseNameById.get(plan.courseId) ?? fallback) : "",
    plan.termId ? (maps.termNameById.get(plan.termId) ?? fallback) : "",
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

function statusTone(status: PaymentInstallmentStatus) {
  if (status === "PAID") return "success";
  if (status === "OVERDUE") return "danger";
  if (status === "CANCELED") return "neutral";
  return "warning";
}

function readFinanceFilters(searchParams: QueryParamReader): FinanceFilters {
  return {
    campusId: searchParams.get("campusId") ?? emptyFilters.campusId,
    classId: searchParams.get("classId") ?? emptyFilters.classId,
    courseId: searchParams.get("courseId") ?? emptyFilters.courseId,
    gradeLevelId: searchParams.get("gradeLevelId") ?? emptyFilters.gradeLevelId,
    studentId: searchParams.get("studentId") ?? emptyFilters.studentId,
    termId: searchParams.get("termId") ?? emptyFilters.termId,
  };
}

function writeFinanceFiltersToUrl(filters: FinanceFilters) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  for (const key of financeFilterKeys) {
    setOptionalQueryParam(url.searchParams, key, filters[key]);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function isSameFinanceFilters(left: FinanceFilters, right: FinanceFilters) {
  return financeFilterKeys.every((key) => left[key] === right[key]);
}

function setOptionalQueryParam(searchParams: URLSearchParams, key: string, value: string) {
  if (value) {
    searchParams.set(key, value);
    return;
  }
  searchParams.delete(key);
}

function countActiveFinanceFilters(filters: FinanceFilters) {
  return financeFilterKeys.filter((key) => filters[key]).length;
}

function formatSortLabel(sort: string) {
  return paymentSortOptions.find((option) => option.value === sort)?.label ?? "Varsayılan";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { currency, style: "currency" }).format(amount / 100);
}

function formatAmountInput(amount: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount / 100);
}

function parseAmountInput(value: string) {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function defaultLocalDateTime() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function createClientIdempotencyKey(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function transactionMethodLabel(method: PaymentTransactionMethod) {
  const labels: Record<PaymentTransactionMethod, string> = {
    BANK_TRANSFER: "Banka havalesi",
    CARD_POS: "Kart POS",
    CASH: "Nakit",
    OTHER: "Diğer",
  };
  return labels[method];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
