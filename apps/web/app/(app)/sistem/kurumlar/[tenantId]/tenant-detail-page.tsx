"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, FormModal, Input, LoadingState, useConfirmDialog } from "@uzman-hocam/ui";
import { useAuth } from "../../../../providers.js";
import {
  firstFormError,
  tenantFormSchema,
  type TenantFormState,
} from "../../../../../src/form-validation.js";
import { MetricPanelGrid } from "../../../kurum/_shared/metric-panel-grid.js";
import { PageFrame } from "../../../kurum/_shared/page-frame.js";
import { deleteTenant, loadTenant, updateTenant, type TenantRecord } from "../../_shared/system-api.js";

const emptyForm: TenantFormState = {
  name: "",
  slug: "",
  plan: "TRIAL",
  licenseStartsAt: "",
  licenseEndsAt: "",
  seatLimit: "",
  status: "ACTIVE",
};

export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const tenantQuery = useQuery({
    queryKey: ["next-tenant", tenantId],
    queryFn: () => loadTenant(auth?.accessToken ?? "", tenantId),
    enabled: Boolean(auth && tenantId),
    refetchOnWindowFocus: false,
  });
  const tenant = tenantQuery.data ?? null;
  const [form, setForm] = useState<TenantFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (tenant) setForm(toTenantForm(tenant));
  }, [tenant]);

  function openEditForm() {
    if (tenant) setForm(toTenantForm(tenant));
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setError("");
    if (tenant) setForm(toTenantForm(tenant));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !tenant) return;

    setError("");
    const parsedForm = tenantFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await updateTenant(auth.accessToken, tenant.id, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
      void queryClient.invalidateQueries({ queryKey: ["next-tenants"] });
      setIsFormOpen(false);
    } catch {
      setError("Kurum güncellenemedi.");
    }
  }

  async function handleDelete() {
    if (!auth || !tenant) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      description: "Kurum listeden kaldırılır, kayıtlar korunur.",
      message: `${tenant.name} kurumunu silmek istiyor musun?`,
      title: "Kurumu sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteTenant(auth.accessToken, tenant.id);
      void queryClient.invalidateQueries({ queryKey: ["next-tenants"] });
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
      router.replace("/sistem/kurumlar");
    } catch {
      setError("Kurum silinemedi.");
    }
  }

  return (
    <PageFrame
      title={tenant?.name ?? "Kurum Detayı"}
      subtitle="Kurum lisans, plan ve durum bilgisini yönet."
      actions={
        tenant ? (
          <>
            <Button onClick={openEditForm}>Düzenle</Button>
            <Button onClick={() => void handleDelete()} variant="secondary">Sil</Button>
          </>
        ) : null
      }
    >
      {tenantQuery.isPending ? <LoadingState label="Kurum detayı yükleniyor…" /> : null}
      {tenantQuery.isError ? <p className="next-form-error">Kurum detayı alınamadı.</p> : null}
      {tenant ? (
        <MetricPanelGrid
          ariaLabel="Kurum detayı"
          metrics={[
            { label: "Slug", value: tenant.slug },
            { label: "Plan", value: tenant.plan },
            { label: "Durum", value: statusLabel(tenant.status) },
            { label: "Koltuk", value: formatSeatUsage(tenant) },
            { label: "Lisans bitişi", value: formatDate(tenant.licenseEndsAt) },
          ]}
        />
      ) : null}
      {error ? <p className="next-form-error">{error}</p> : null}
      <TenantEditModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
      />
      {confirmationDialog}
    </PageFrame>
  );
}

function TenantEditModal({
  form,
  onCancel,
  onChange,
  onSubmit,
  open,
}: {
  form: TenantFormState;
  onCancel(): void;
  onChange(value: TenantFormState): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
}) {
  return (
    <FormModal
      description="Kurum kimliği, lisans ve durum bilgisini güncelle."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel="Kaydet"
      title="Kurum düzenle"
    >
      <label>
        Kurum adı
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </label>
      <label>
        Slug
        <Input required value={form.slug} onChange={(event) => onChange({ ...form, slug: event.target.value })} />
        <small className="next-field-help">Kurumun teknik kısa adı. Örn: yeni-kurum. URL ve sistem kimliği için kullanılır.</small>
      </label>
      <label>
        Plan
        <select value={form.plan} onChange={(event) => onChange({ ...form, plan: event.target.value as TenantFormState["plan"] })}>
          <option value="TRIAL">TRIAL</option>
          <option value="PRO">PRO</option>
          <option value="ENTERPRISE">ENTERPRISE</option>
        </select>
      </label>
      <label>
        Lisans başlangıç
        <Input type="date" value={form.licenseStartsAt ?? ""} onChange={(event) => onChange({ ...form, licenseStartsAt: event.target.value })} />
      </label>
      <label>
        Lisans bitiş
        <Input type="date" value={form.licenseEndsAt ?? ""} onChange={(event) => onChange({ ...form, licenseEndsAt: event.target.value })} />
      </label>
      <label>
        Koltuk limiti
        <Input inputMode="numeric" value={form.seatLimit ?? ""} onChange={(event) => onChange({ ...form, seatLimit: event.target.value })} />
        <small className="next-field-help">Bu kuruma tanımlanabilecek aktif kullanıcı sayısı. Boş bırakırsan sınırsız olur.</small>
      </label>
      <label>
        Durum
        <select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TenantFormState["status"] })}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="TRIAL">TRIAL</option>
        </select>
      </label>
    </FormModal>
  );
}

function toTenantForm(tenant: TenantRecord): TenantFormState {
  return {
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan === "PRO" || tenant.plan === "ENTERPRISE" ? tenant.plan : "TRIAL",
    licenseStartsAt: toDateInput(tenant.licenseStartsAt),
    licenseEndsAt: toDateInput(tenant.licenseEndsAt),
    seatLimit: tenant.seatLimit ? String(tenant.seatLimit) : "",
    status: tenant.status === "SUSPENDED" || tenant.status === "TRIAL" ? tenant.status : "ACTIVE",
  };
}

function toDateInput(value: string | undefined) {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString("tr-TR") : "-";
}

function formatSeatUsage(tenant: TenantRecord) {
  const used = tenant.activeSeatCount ?? 0;
  return tenant.seatLimit ? `${used} / ${tenant.seatLimit}` : `${used} / Sınırsız`;
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Aktif";
  if (status === "SUSPENDED") return "Askıda";
  if (status === "TRIAL") return "Deneme";
  return status;
}
