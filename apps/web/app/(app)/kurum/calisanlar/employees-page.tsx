"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CampusRecord,
  EmployeeAccountInvitationRequest,
  EmployeeAccessRecord,
  EmployeeAccessListQuery,
  EmployeeAccessSort,
  EmployeeCreateRequest,
  EmployeeInvitationRole,
  EmployeeStaffRole,
  MfaStepUpRequest,
  MfaStepUpResponse,
  TenantMembershipLifecycleStatus,
  TenantMembershipScopeMode,
  TenantMembershipUpdateRequest,
  TenantMembershipUpdateResult,
} from "@o-okul/shared-types";
import { tenantRoleLabel } from "@o-okul/shared-types";
import {
  Button,
  Checkbox,
  CrudPage,
  EmptyState,
  Field,
  FilterBar,
  FormModal,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@o-okul/ui";
import { ChevronLeft, ChevronRight, MailPlus, Pencil, Plus, Search } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiCursorListRequest, apiListRequest, apiRequest, type CursorListMeta } from "../../../../src/api-client.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

export function EmployeesPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const searchParamsKey = searchParams.toString();
  const [listQuery, setListQuery] = useState<EmployeeAccessListQuery>(() => readEmployeeListQuery(searchParams));
  useEffect(() => {
    const next = readEmployeeListQuery(new URLSearchParams(searchParamsKey));
    setListQuery((current) => sameEmployeeListQuery(current, next) ? current : next);
  }, [searchParamsKey]);
  const updateListQuery = (next: EmployeeAccessListQuery) => {
    setListQuery(next);
    writeEmployeeListQuery(next);
  };
  const employeesQuery = useQuery({
    queryKey: ["employees", tenantId, listQuery],
    queryFn: () => loadEmployees(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const employees = employeesQuery.data?.data ?? [];
  const campusesQuery = useQuery({
    queryKey: ["employee-access-campuses", tenantId],
    queryFn: () => loadCampuses(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const campuses = campusesQuery.data?.data ?? [];
  const [editingEmployee, setEditingEmployee] = useState<EmployeeAccessRecord | null>(null);
  const [invitingEmployee, setInvitingEmployee] = useState<EmployeeAccessRecord | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<EmployeeCreateRequest>(emptyEmployeeCreateForm);
  const [invitationForm, setInvitationForm] = useState<EmployeeAccountInvitationRequest>({ email: "", role: "OPERATIONS_STAFF" });
  const [form, setForm] = useState<EmployeeAccessFormState>(emptyAccessForm);
  const [stepUpCode, setStepUpCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const canManageOwners = auth?.session.roles.includes("TENANT_OWNER") ?? false;
  const linkedCount = employees.filter((employee) => employee.access).length;
  const columns: Array<DataTableColumn<EmployeeAccessRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      sticky: "left",
      render: (employee) => `${employee.firstName} ${employee.lastName}`,
    },
    { key: "employeeNo", header: "Sicil no", priority: "secondary", render: (employee) => employee.employeeNo ?? "-" },
    { key: "workEmail", header: "İş e-postası", priority: "secondary", render: (employee) => maskEmail(employee.workEmail) },
    {
      key: "role",
      header: "Yetki / çalışma alanı",
      priority: "primary",
      render: (employee) => accessLabel(employee),
    },
    {
      key: "status",
      header: "Durum",
      priority: "primary",
      render: (employee) => <StatusBadge tone={statusTone(employee)}>{statusLabel(employee)}</StatusBadge>,
    },
    {
      key: "scope",
      header: "Kapsam",
      priority: "optional",
      render: (employee) => employee.access?.scopeMode === "CAMPUSES"
        ? `${formatCount(employee.access.campusIds.length)} kampüs`
        : employee.access ? "Tüm kurum" : "-",
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      sticky: "right",
      render: (employee) => {
        const ownerLocked = employee.access?.staffRole === "TENANT_OWNER" && !canManageOwners;
        const endedLocked = employee.access?.status === "ENDED";
        return (
          <span className="next-row-actions">
            {!employee.userId ? (
              <Button
                aria-label={`${employee.firstName} ${employee.lastName} için hesap daveti gönder`}
                disabled={employee.status !== "ACTIVE"}
                onClick={() => openInvitationForm(employee)}
                size="icon"
                title={employee.status !== "ACTIVE" ? "Davet için çalışan profili aktif olmalıdır." : "Hesap daveti gönder"}
                type="button"
                variant="ghost"
              >
                <MailPlus aria-hidden="true" size={17} />
              </Button>
            ) : null}
            <Button
              aria-label={`${employee.firstName} ${employee.lastName} erişimini düzenle`}
              disabled={!employee.access || ownerLocked || endedLocked}
              onClick={() => openAccessForm(employee)}
              size="icon"
              title={
                ownerLocked
                  ? "Kurum sahibi erişimini yalnız başka bir kurum sahibi değiştirebilir."
                  : endedLocked ? "Sonlandırılmış erişim yeniden değiştirilemez." : undefined
              }
              type="button"
              variant="ghost"
            >
              <Pencil aria-hidden="true" size={17} />
            </Button>
          </span>
        );
      },
    },
  ];
  const summaryItems: OperationSummaryItem[] = [
    {
      key: "employees",
      label: "Bu sayfadaki çalışan",
      description: "Bu sayfadaki silinmemiş çalışan kayıtları",
      value: formatCount(employees.length),
    },
    {
      key: "linked",
      label: "Hesap bağlı",
      description: "Bu sayfadaki kurum üyeliği görünümü",
      value: formatCount(linkedCount),
      tone: linkedCount === employees.length ? "success" : "warning",
    },
  ];
  const badges: OperationSummaryBadge[] = [{ key: "mode", label: "Yetki yönetimi aktif", tone: "success" }];

  function openAccessForm(employee: EmployeeAccessRecord) {
    if (!employee.access) return;
    setEditingEmployee(employee);
    setForm({
      campusIds: [...employee.access.campusIds],
      endedReason: "",
      hasTeacherPersona: employee.access.hasTeacherPersona,
      scopeMode: employee.access.scopeMode,
      staffRole: employee.access.staffRole ?? "",
      status: employee.access.status === "SUSPENDED" ? "SUSPENDED" : employee.access.status === "ENDED" ? "ENDED" : "ACTIVE",
    });
    setSubmitError("");
    setStepUpCode("");
  }

  function openInvitationForm(employee: EmployeeAccessRecord) {
    setInvitingEmployee(employee);
    setInvitationForm({ email: employee.workEmail ?? "", role: "OPERATIONS_STAFF" });
    setSubmitError("");
    setStepUpCode("");
  }

  async function handleCreateEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setIsSaving(true);
    setSubmitError("");
    try {
      await createEmployee(auth.accessToken, createForm);
      await queryClient.invalidateQueries({ queryKey: ["employees", tenantId] });
      setIsCreateOpen(false);
      setCreateForm(emptyEmployeeCreateForm);
      setActionNotice("Çalışan profili oluşturuldu. Hesap gerektiğinde satırdaki davet işlemini kullanın.");
    } catch (error) {
      setSubmitError(employeeWriteErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleInviteEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !invitingEmployee) return;
    const requiresStepUp = elevatedInvitationRole(invitationForm.role);
    if (requiresStepUp && !stepUpCode.trim()) {
      setSubmitError("Kurum sahibi veya yöneticisi daveti için iki aşamalı doğrulama kodunu girin.");
      return;
    }
    setIsSaving(true);
    setSubmitError("");
    try {
      const stepUpToken = requiresStepUp
        ? (await createMfaStepUp(auth.accessToken, stepUpCode.trim())).stepUpToken
        : undefined;
      await inviteEmployee(auth.accessToken, invitingEmployee.id, invitationForm, stepUpToken);
      setInvitingEmployee(null);
      setStepUpCode("");
      setActionNotice("Hesap daveti gönderime alındı. Hesabı açma bağlantısı 24 saat geçerlidir.");
    } catch (error) {
      setSubmitError(employeeWriteErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function closeAccessForm() {
    if (isSaving) return;
    setEditingEmployee(null);
    setForm(emptyAccessForm);
    setStepUpCode("");
    setSubmitError("");
  }

  function toggleCampus(campusId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      campusIds: checked
        ? [...new Set([...current.campusIds, campusId])]
        : current.campusIds.filter((id) => id !== campusId),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !editingEmployee?.access) return;
    if (!form.staffRole && !form.hasTeacherPersona) {
      setSubmitError("En az bir çalışan rolü veya öğretmen çalışma alanı seçin.");
      return;
    }
    if (form.scopeMode === "CAMPUSES" && form.campusIds.length === 0) {
      setSubmitError("Kampüs kapsamı için en az bir kampüs seçin.");
      return;
    }
    if (form.status === "ENDED" && !form.endedReason.trim()) {
      setSubmitError("Erişimi sonlandırmak için gerekçe yazın.");
      return;
    }

    const input: TenantMembershipUpdateRequest = {
      campusIds: form.scopeMode === "TENANT" ? [] : form.campusIds,
      expectedVersion: editingEmployee.access.version,
      hasTeacherPersona: form.hasTeacherPersona,
      scopeMode: form.scopeMode,
      status: form.status,
      ...(form.staffRole ? { staffRole: form.staffRole } : {}),
      ...(form.status === "ENDED" ? { endedReason: form.endedReason.trim() } : {}),
    };
    const requiresStepUp = ownerAdminStepUpRequired(editingEmployee.access.staffRole, form.staffRole);
    if (requiresStepUp && !stepUpCode.trim()) {
      setSubmitError("Kurum sahibi veya yöneticisi değişikliği için iki aşamalı doğrulama kodunu girin.");
      return;
    }
    setIsSaving(true);
    setSubmitError("");
    try {
      const stepUpToken = requiresStepUp
        ? (await createMfaStepUp(auth.accessToken, stepUpCode.trim())).stepUpToken
        : undefined;
      await updateMembership(auth.accessToken, editingEmployee.access.membershipId, input, stepUpToken);
      await queryClient.invalidateQueries({ queryKey: ["employees", tenantId] });
      setEditingEmployee(null);
      setForm(emptyAccessForm);
      setStepUpCode("");
      setSubmitError("");
    } catch (error) {
      setSubmitError(membershipErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <CrudPage
        actions={(
          <div className="next-row-actions">
            <Button onClick={() => { setIsCreateOpen(true); setSubmitError(""); }} type="button">
              <Plus aria-hidden="true" size={17} /> Yeni çalışan
            </Button>
            <EmployeeCursorControls meta={employeesQuery.data?.meta} onChange={updateListQuery} state={listQuery} />
          </div>
        )}
        aria-label="Çalışan ve yetki görünümü"
        columns={columns}
        density="compact"
        description="Çalışan profili, hesap durumu ve kurumdaki erişimini birlikte yönetin."
        emptyState={<EmptyState title="Çalışan yok" description="Kurum için çalışan kaydı bulunamadı." />}
        emptyText="Çalışan kaydı yok"
        error={employeesQuery.isError ? "Çalışanlar alınamadı." : undefined}
        getRowKey={(employee) => employee.id}
        hasActiveFilters={Boolean(listQuery.q?.trim())}
        loading={employeesQuery.isPending}
        rows={employees}
        summary={<OperationSummary ariaLabel="Çalışan erişim özeti" badges={badges} items={summaryItems} />}
        tableCaption="Kurum çalışanları ve yetkileri"
        tableDescription="Çalışan, hesap, rol, çalışma alanı, çalışma durumu ve kampüs kapsamı."
        title="Çalışanlar ve Yetkiler"
      />
      {actionNotice ? <p className="next-status-note" role="status">{actionNotice}</p> : null}
      <FormModal
        description="Profil, hesap ve yetkiden bağımsız oluşturulur. Planlı çalışan daha sonra aktifleştirilebilir."
        onCancel={() => { if (!isSaving) { setIsCreateOpen(false); setSubmitError(""); } }}
        onSubmit={(event) => void handleCreateEmployee(event)}
        open={isCreateOpen}
        submitError={submitError}
        submitLabel="Profili oluştur"
        submitting={isSaving}
        title="Yeni çalışan"
      >
        <Field label="Ad"><Input required value={createForm.firstName} onChange={(event) => setCreateForm((current) => ({ ...current, firstName: event.target.value }))} /></Field>
        <Field label="Soyad"><Input required value={createForm.lastName} onChange={(event) => setCreateForm((current) => ({ ...current, lastName: event.target.value }))} /></Field>
        <Field label="Sicil no"><Input value={createForm.employeeNo ?? ""} onChange={(event) => setCreateForm((current) => ({ ...current, employeeNo: event.target.value || undefined }))} /></Field>
        <Field label="İş e-postası"><Input type="email" value={createForm.workEmail ?? ""} onChange={(event) => setCreateForm((current) => ({ ...current, workEmail: event.target.value || undefined }))} /></Field>
        <Field label="İşe başlama tarihi"><Input type="date" value={createForm.employmentStartsAt ?? ""} onChange={(event) => setCreateForm((current) => ({ ...current, employmentStartsAt: event.target.value || undefined }))} /></Field>
        <Field label="Profil durumu">
          <Select value={createForm.status} onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as EmployeeCreateRequest["status"] }))}>
            <option value="PLANNED">Planlı</option>
            <option value="ACTIVE">Aktif</option>
          </Select>
        </Field>
      </FormModal>
      <FormModal
        description="Davet e-posta ile iletilir; parola veya hesap açma bilgisi bu ekranda gösterilmez. Kurum sahibi ve kurum yöneticisi davetleri iki aşamalı doğrulama ister."
        onCancel={() => { if (!isSaving) { setInvitingEmployee(null); setStepUpCode(""); setSubmitError(""); } }}
        onSubmit={(event) => void handleInviteEmployee(event)}
        open={Boolean(invitingEmployee)}
        submitError={submitError}
        submitLabel="Daveti gönder"
        submitting={isSaving}
        title={invitingEmployee ? `${invitingEmployee.firstName} ${invitingEmployee.lastName} hesap daveti` : "Hesap daveti"}
      >
        <Field label="İş e-postası"><Input required type="email" value={invitationForm.email} onChange={(event) => setInvitationForm((current) => ({ ...current, email: event.target.value }))} /></Field>
        <Field label="Başlangıç rolü">
          <Select value={invitationForm.role} onChange={(event) => setInvitationForm((current) => ({ ...current, role: event.target.value as EmployeeInvitationRole }))}>
            {canManageOwners ? <option value="TENANT_OWNER">Kurum sahibi</option> : null}
            <option value="TENANT_ADMIN">Kurum yöneticisi</option>
            <option value="OPERATIONS_STAFF">Operasyon çalışanı</option>
            <option value="FINANCE_STAFF">Finans çalışanı</option>
          </Select>
        </Field>
        {elevatedInvitationRole(invitationForm.role) ? (
          <Field label="İki aşamalı doğrulama kodu" description="Doğrulama uygulamasındaki 6 haneli kodu veya tek kullanımlık kurtarma kodunu girin.">
            <Input
              autoComplete="one-time-code"
              required
              type="password"
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value)}
            />
          </Field>
        ) : null}
      </FormModal>
      <FormModal
        description="Görev, çalışma alanı veya erişim kapsamı değişikliği açık oturumları kapatır. Sonlandırılan erişim yeniden açılamaz."
        onCancel={closeAccessForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={Boolean(editingEmployee)}
        submitError={submitError}
        submitLabel="Erişimi güncelle"
        submitting={isSaving}
        title={editingEmployee ? `${editingEmployee.firstName} ${editingEmployee.lastName} erişimi` : "Çalışan erişimi"}
      >
        <Field label="Çalışan rolü" description="Yalnız öğretmen hesabı için rol seçmeyebilirsiniz.">
          <Select
            value={form.staffRole}
            onChange={(event) => setForm((current) => ({ ...current, staffRole: event.target.value as EmployeeAccessFormState["staffRole"] }))}
          >
            <option value="">Çalışan rolü yok</option>
            {canManageOwners ? <option value="TENANT_OWNER">Kurum sahibi</option> : null}
            <option value="TENANT_ADMIN">Kurum yöneticisi</option>
            <option value="OPERATIONS_STAFF">Operasyon çalışanı</option>
            <option value="FINANCE_STAFF">Finans çalışanı</option>
          </Select>
        </Field>
        <Checkbox
          checked={form.hasTeacherPersona}
          description="Kurum yetkileriyle birleşmez; öğretmen çalışma alanında ayrı erişim bağlamı kullanılır."
          label="Öğretmen çalışma alanı"
          onChange={(event) => setForm((current) => ({ ...current, hasTeacherPersona: event.target.checked }))}
        />
        <Field label="Erişim durumu">
          <Select
            disabled={editingEmployee?.access?.status === "ENDED"}
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as TenantMembershipLifecycleStatus }))}
          >
            <option value="ACTIVE">Aktif</option>
            <option value="SUSPENDED">Askıda</option>
            <option value="ENDED">Sonlandırıldı</option>
          </Select>
        </Field>
        {form.status === "ENDED" ? (
          <Field label="Sonlandırma gerekçesi">
            <Input
              maxLength={500}
              required
              value={form.endedReason}
              onChange={(event) => setForm((current) => ({ ...current, endedReason: event.target.value }))}
            />
          </Field>
        ) : null}
        <Field label="Yetki kapsamı">
          <Select
            value={form.scopeMode}
            onChange={(event) => setForm((current) => ({
              ...current,
              campusIds: event.target.value === "TENANT" ? [] : current.campusIds,
              scopeMode: event.target.value as TenantMembershipScopeMode,
            }))}
          >
            <option value="TENANT">Tüm kurum</option>
            <option value="CAMPUSES">Seçili kampüsler</option>
          </Select>
        </Field>
        {form.scopeMode === "CAMPUSES" ? (
          <div className="next-checkbox-list" role="group" aria-label="Yetkili kampüsler">
            {campuses.map((campus) => (
              <Checkbox
                checked={form.campusIds.includes(campus.id)}
                className="next-checkbox-option"
                key={campus.id}
                label={campus.name}
                onChange={(event) => toggleCampus(campus.id, event.target.checked)}
                value={campus.id}
              />
            ))}
            {campusesQuery.isPending ? <p className="next-field-help">Kampüsler yükleniyor.</p> : null}
            {!campusesQuery.isPending && campuses.length === 0 ? <p className="next-field-help">Seçilebilir kampüs bulunamadı.</p> : null}
          </div>
        ) : null}
        {editingEmployee?.access && ownerAdminStepUpRequired(editingEmployee.access.staffRole, form.staffRole) ? (
          <Field label="İki aşamalı doğrulama kodu" description="Doğrulama uygulamasındaki 6 haneli kodu veya tek kullanımlık kurtarma kodunu girin.">
            <Input
              autoComplete="one-time-code"
              required
              type="password"
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value)}
            />
          </Field>
        ) : null}
      </FormModal>
    </>
  );
}

function accessLabel(employee: EmployeeAccessRecord) {
  if (!employee.access) return "Hesap bağlı değil";
  const labels = employee.access.staffRole ? [tenantRoleLabel(employee.access.staffRole)] : [];
  if (employee.access.hasTeacherPersona) labels.push("Öğretmen çalışma alanı");
  return labels.join(" + ") || "Yetki atanmamış";
}

function statusLabel(employee: EmployeeAccessRecord) {
  if (employee.status !== "ACTIVE") return employee.status === "PLANNED" ? "Planlandı" : "Pasif";
  if (!employee.access) return "Hesap bağlı değil";
  if (employee.accountStatus !== "ACTIVE" || employee.access.status !== "ACTIVE") return "Erişim kapalı";
  return "Aktif";
}

function statusTone(employee: EmployeeAccessRecord): StatusBadgeProps["tone"] {
  if (employee.status === "ACTIVE" && employee.accountStatus === "ACTIVE" && employee.access?.status === "ACTIVE") return "success";
  if (employee.status === "PLANNED" || !employee.access) return "warning";
  return "danger";
}

function maskEmail(value: string | undefined) {
  if (!value) return "-";
  const [localPart = "", domain = ""] = value.split("@");
  if (!domain) return "E-posta kayıtlı";
  return `${localPart.slice(0, 2) || "••"}••@${domain.replace(/^[^.]*/, "•••")}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

const employeeSortOptions = [
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
  { label: "Ad A-Z", value: "firstName" },
  { label: "Sicil no", value: "employeeNo" },
];

function EmployeeCursorControls({
  meta,
  onChange,
  state,
}: {
  meta?: CursorListMeta;
  onChange(next: EmployeeAccessListQuery): void;
  state: EmployeeAccessListQuery;
}) {
  return (
    <FilterBar className="next-list-controls" role="group" aria-label="Çalışan liste kontrolleri">
      <Field className="next-list-search" label="Ara">
        <Search size={17} aria-hidden="true" />
        <Input
          aria-label="Ara"
          placeholder="Ad, sicil no veya iş e-postası"
          value={state.q ?? ""}
          onChange={(event) => onChange(resetEmployeeCursor(state, { q: event.target.value }))}
        />
      </Field>
      <Field label="Sırala">
        <Select value={state.sort} onChange={(event) => onChange(resetEmployeeCursor(state, { sort: event.target.value as EmployeeAccessSort }))}>
          {employeeSortOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Göster">
        <Select value={state.limit} onChange={(event) => onChange(resetEmployeeCursor(state, { limit: Number(event.target.value) }))}>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </Select>
      </Field>
      <span className="next-list-status">Kayıt sayfası</span>
      <Button
        aria-label="Önceki çalışanlar"
        disabled={!meta?.previousCursor}
        onClick={() => meta?.previousCursor && onChange({ ...state, cursor: meta.previousCursor, direction: "previous" })}
        variant="secondary"
      >
        <ChevronLeft size={17} aria-hidden="true" />
      </Button>
      <Button
        aria-label="Sonraki çalışanlar"
        disabled={!meta?.nextCursor}
        onClick={() => meta?.nextCursor && onChange({ ...state, cursor: meta.nextCursor, direction: "next" })}
        variant="secondary"
      >
        <ChevronRight size={17} aria-hidden="true" />
      </Button>
    </FilterBar>
  );
}

function resetEmployeeCursor(
  state: EmployeeAccessListQuery,
  changes: Partial<Pick<EmployeeAccessListQuery, "limit" | "q" | "sort">>,
): EmployeeAccessListQuery {
  return { ...state, ...changes, cursor: undefined, direction: "next" };
}

function readEmployeeListQuery(searchParams: Pick<URLSearchParams, "get">): EmployeeAccessListQuery {
  const sort = searchParams.get("employeesSort");
  const cursor = searchParams.get("employeesCursor")?.trim() || undefined;
  return {
    cursor,
    direction: cursor && searchParams.get("employeesDirection") === "previous" ? "previous" : "next",
    limit: employeeListLimit(searchParams.get("employeesLimit")),
    q: searchParams.get("employeesQ")?.trim() || undefined,
    sort: isEmployeeAccessSort(sort) ? sort : "lastName",
  };
}

function writeEmployeeListQuery(state: EmployeeAccessListQuery) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("employeesLimit", String(state.limit));
  url.searchParams.set("employeesSort", state.sort);
  setEmployeeListQueryParam(url.searchParams, "employeesQ", state.q);
  setEmployeeListQueryParam(url.searchParams, "employeesCursor", state.cursor);
  setEmployeeListQueryParam(url.searchParams, "employeesDirection", state.cursor ? state.direction : undefined);
  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function setEmployeeListQueryParam(searchParams: URLSearchParams, name: string, value: string | undefined) {
  if (value) {
    searchParams.set(name, value);
    return;
  }
  searchParams.delete(name);
}

function sameEmployeeListQuery(left: EmployeeAccessListQuery, right: EmployeeAccessListQuery): boolean {
  return left.cursor === right.cursor && left.direction === right.direction && left.limit === right.limit && left.q === right.q && left.sort === right.sort;
}

function employeeListLimit(value: string | null): number {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 ? parsed : 50;
}

function isEmployeeAccessSort(value: string | null): value is EmployeeAccessSort {
  return value === "lastName" || value === "-lastName" || value === "firstName" || value === "employeeNo";
}

async function loadEmployees(accessToken: string, listQuery: EmployeeAccessListQuery) {
  const query = new URLSearchParams({
    direction: listQuery.direction,
    limit: String(listQuery.limit),
    sort: listQuery.sort,
  });
  if (listQuery.cursor) query.set("cursor", listQuery.cursor);
  if (listQuery.q) query.set("q", listQuery.q);
  return apiCursorListRequest<EmployeeAccessRecord>(accessToken, `${apiBaseUrl}/employees?${query.toString()}`);
}

function createEmployee(accessToken: string, input: EmployeeCreateRequest) {
  return apiRequest<EmployeeAccessRecord>(accessToken, `${apiBaseUrl}/employees`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function inviteEmployee(
  accessToken: string,
  employeeId: string,
  input: EmployeeAccountInvitationRequest,
  stepUpToken?: string,
) {
  return apiRequest(accessToken, `${apiBaseUrl}/employees/${encodeURIComponent(employeeId)}/account-invitations`, {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      ...(stepUpToken ? { "x-step-up-token": stepUpToken } : {}),
    },
    method: "POST",
  });
}

function employeeWriteErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.code === "EMPLOYEE_INVITATION_ALREADY_PENDING") return "Bu çalışan için zaten bekleyen bir davet var.";
  if (error instanceof ApiRequestError && error.code === "EMPLOYEE_UNIQUE_CONFLICT") return "Sicil numarası veya hesap bağı başka bir çalışan tarafından kullanılıyor.";
  if (error instanceof ApiRequestError && error.code === "TENANT_OWNER_MANAGE_REQUIRED") return "Kurum sahibi davetini yalnız başka bir kurum sahibi gönderebilir.";
  const stepUpError = mfaStepUpErrorMessage(error);
  if (stepUpError) return stepUpError;
  return "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.";
}

async function loadCampuses(accessToken: string) {
  return apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`);
}

async function createMfaStepUp(accessToken: string, code: string) {
  const input: MfaStepUpRequest = {
    purpose: "OWNER_ADMIN_CHANGE",
    ...(/^\d{6}$/.test(code.replace(/\s/g, "")) ? { totpCode: code } : { recoveryCode: code }),
  };
  return apiRequest<MfaStepUpResponse>(accessToken, `${apiBaseUrl}/auth/step-up`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateMembership(
  accessToken: string,
  membershipId: string,
  input: TenantMembershipUpdateRequest,
  stepUpToken?: string,
) {
  return apiRequest<TenantMembershipUpdateResult>(
    accessToken,
    `${apiBaseUrl}/tenant-memberships/${encodeURIComponent(membershipId)}`,
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        ...(stepUpToken ? { "x-step-up-token": stepUpToken } : {}),
      },
      method: "PATCH",
    },
  );
}

function membershipErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "Çalışan erişimi güncellenemedi.";
  if (error.code === "TENANT_MEMBERSHIP_VERSION_CONFLICT") return "Kayıt başka bir işlemde değişti. Listeyi yenileyip tekrar deneyin.";
  if (error.code === "TENANT_OWNER_MANAGE_REQUIRED") return "Kurum sahibi erişimini yalnız başka bir kurum sahibi değiştirebilir.";
  if (error.code === "LAST_ACTIVE_TENANT_OWNER_REQUIRED") return "Kurumun son aktif sahibi kapatılamaz veya rolü düşürülemez.";
  if (error.code === "EMPLOYEE_PROFILE_NOT_ACTIVE") return "Aktif olmayan çalışan profiline erişim açılamaz.";
  if (error.code === "TENANT_MEMBERSHIP_CAMPUS_NOT_FOUND") return "Seçilen kampüslerden biri artık kullanılamıyor.";
  if (error.code === "TENANT_MEMBERSHIP_ENDED") return "Sonlandırılmış erişim yeniden değiştirilemez.";
  const stepUpError = mfaStepUpErrorMessage(error);
  if (stepUpError) return stepUpError;
  return "Çalışan erişimi güncellenemedi.";
}

function mfaStepUpErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  if (error.code === "STEP_UP_MFA_REQUIRED") return "Kurum sahibi veya yöneticisi işlemi için iki aşamalı doğrulama zorunludur.";
  if (error.code === "STEP_UP_MFA_INVALID") return "İki aşamalı doğrulamanın süresi doldu. Yeni kodla tekrar deneyin.";
  if (error.code === "MFA_NOT_ENABLED" || error.code === "ADMIN_MFA_DISABLED") return "Bu işlem için hesabınızda iki aşamalı doğrulama açık olmalıdır.";
  if (error.code === "MFA_CODE_INVALID" || error.code === "MFA_RECOVERY_CODE_INVALID" || error.code === "MFA_CODE_REUSED") {
    return "Doğrulama kodu geçersiz veya daha önce kullanılmış. Yeni bir kod deneyin.";
  }
  return undefined;
}

function ownerAdminStepUpRequired(currentRole: EmployeeStaffRole | undefined, nextRole: EmployeeStaffRole | ""): boolean {
  return currentRole === "TENANT_OWNER" || currentRole === "TENANT_ADMIN" || nextRole === "TENANT_OWNER" || nextRole === "TENANT_ADMIN";
}

function elevatedInvitationRole(role: EmployeeInvitationRole): boolean {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN";
}

interface EmployeeAccessFormState {
  campusIds: string[];
  endedReason: string;
  hasTeacherPersona: boolean;
  scopeMode: TenantMembershipScopeMode;
  staffRole: EmployeeStaffRole | "";
  status: TenantMembershipLifecycleStatus;
}

const emptyAccessForm: EmployeeAccessFormState = {
  campusIds: [],
  endedReason: "",
  hasTeacherPersona: false,
  scopeMode: "TENANT",
  staffRole: "",
  status: "ACTIVE",
};

const emptyEmployeeCreateForm: EmployeeCreateRequest = {
  firstName: "",
  lastName: "",
  status: "PLANNED",
};
