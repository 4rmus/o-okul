"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError } from "../../../../src/api-client.js";
import {
  firstFormError,
  tenantCreateFormSchema,
  type TenantCreateFormState,
  type TenantFormState,
} from "../../../../src/form-validation.js";
import { initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";
import { PageFrame } from "../../kurum/_shared/page-frame.js";
import { createTenant, deleteTenant, loadTenants, type TenantRecord } from "../_shared/system-api.js";

const emptyForm: TenantFormState = {
  name: "",
  slug: "",
  plan: "TRIAL",
  licenseStartsAt: "",
  licenseEndsAt: "",
  seatLimit: "",
  status: "ACTIVE",
};

const emptyCreateForm: TenantCreateFormState = {
  ...emptyForm,
  firstAdmin: {
    name: "",
    email: "",
    mode: "password",
    password: "",
  },
};

export function TenantsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-tenants", listQuery];
  const listQueryKey = ["next-tenants"];
  const tenantsQuery = useQuery({
    queryKey,
    queryFn: () => loadTenants(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<TenantCreateFormState>(emptyCreateForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<{ email: string; token: string } | null>(null);
  const [deletingTenantId, setDeletingTenantId] = useState("");
  const [error, setError] = useState("");
  const rows = tenantsQuery.data?.data ?? [];

  const columns: Array<DataTableColumn<TenantRecord>> = [
    { key: "name", header: "Kurum", render: (tenant) => tenant.name },
    { key: "slug", header: "Slug", render: (tenant) => tenant.slug },
    { key: "plan", header: "Plan", render: (tenant) => tenant.plan },
    { key: "licenseEndsAt", header: "Lisans bitişi", render: (tenant) => formatDate(tenant.licenseEndsAt) },
    { key: "seatLimit", header: "Koltuk", render: (tenant) => formatSeatUsage(tenant) },
    { key: "status", header: "Durum", render: (tenant) => statusLabel(tenant.status) },
    {
      key: "actions",
      header: "İşlem",
      render: (tenant) => (
        <div className="next-row-actions">
          <Link href={`/sistem/kurumlar/${encodeURIComponent(tenant.id)}`}>Detay</Link>
          <button type="button" disabled={deletingTenantId === tenant.id} onClick={() => void handleDeleteTenant(tenant)}>
            Sil
          </button>
        </div>
      ),
    },
  ];

  function openCreateForm() {
    setForm(emptyCreateForm);
    setIssuedToken(null);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setForm(emptyCreateForm);
  }

  function updateName(value: string) {
    setForm((current) => ({
      ...current,
      name: value,
      slug: current.slug || slugify(value),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = tenantCreateFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const created = await createTenant(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
      setIssuedToken(created.admin.activationToken ? { email: created.admin.email, token: created.admin.activationToken } : null);
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", created.tenant.id] });
    } catch (createError) {
      setError(tenantCreateErrorMessage(createError));
    }
  }

  async function handleDeleteTenant(tenant: TenantRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      description: "Kurum listeden kaldırılır, kayıtlar korunur.",
      message: `${tenant.name} kurumunu silmek istiyor musun?`,
      title: "Kurumu sil",
    });
    if (!confirmed) return;

    setError("");
    setDeletingTenantId(tenant.id);
    try {
      await deleteTenant(auth.accessToken, tenant.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
    } catch {
      setError("Kurum silinemedi.");
    } finally {
      setDeletingTenantId("");
    }
  }

  return (
    <PageFrame title="Kurumlar" subtitle="Platformdaki kurumları listele ve yeni kurum aç.">
      <CrudPage
        actions={
          <>
            <ListControls meta={tenantsQuery.data?.meta} onChange={setListQuery} sortOptions={tenantSortOptions} state={listQuery} />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Kurum oluştur
            </Button>
          </>
        }
        aria-label="Kurum yönetimi"
        columns={columns}
        description="SYSTEM_ADMIN kurum kayıtlarını buradan yönetir."
        emptyState={
          <EmptyState
            title="Henüz kurum yok"
            description="İlk kurumunu oluşturarak sıfır-veri kurulum zincirini başlat."
            primaryAction={{ label: "Kurum oluştur", onClick: openCreateForm }}
          />
        }
        emptyText="Kurum kaydı yok"
        error={error || (tenantsQuery.isError ? "Kurumlar alınamadı." : undefined)}
        getRowKey={(tenant) => tenant.id}
        loading={tenantsQuery.isPending}
        rows={rows}
        title="Kurumlar"
      />
      {issuedToken ? (
        <section className="next-token-panel" aria-label="İlk admin aktivasyon tokenı">
          <strong>{issuedToken.email}</strong>
          <code>{issuedToken.token}</code>
        </section>
      ) : null}
      <TenantFormModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onNameChange={updateName}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Oluştur"
        title="Kurum oluştur"
      />
      {confirmationDialog}
    </PageFrame>
  );
}

function TenantFormModal({
  form,
  onCancel,
  onChange,
  onNameChange,
  onSubmit,
  open,
  submitLabel,
  title,
}: {
  form: TenantCreateFormState;
  onCancel(): void;
  onChange(value: TenantCreateFormState): void;
  onNameChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
  submitLabel: string;
  title: string;
}) {
  return (
    <FormModal
      description="Kurum ve ilk yönetici hesabı birlikte oluşturulur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel={submitLabel}
      title={title}
    >
      <label>
        Kurum adı
        <Input required value={form.name} onChange={(event) => onNameChange(event.target.value)} />
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
      <label>
        Admin ad soyad
        <Input
          required
          value={form.firstAdmin.name}
          onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, name: event.target.value } })}
        />
      </label>
      <label>
        Admin e-posta
        <Input
          required
          type="email"
          value={form.firstAdmin.email}
          onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, email: event.target.value } })}
        />
      </label>
      <label>
        İlk admin modu
        <select
          value={form.firstAdmin.mode}
          onChange={(event) =>
            onChange({
              ...form,
              firstAdmin: {
                ...form.firstAdmin,
                mode: event.target.value as TenantCreateFormState["firstAdmin"]["mode"],
                password: "",
              },
            })
          }
        >
          <option value="password">Şifre belirle</option>
          <option value="invitation">Davet gönder</option>
        </select>
      </label>
      {form.firstAdmin.mode === "password" ? (
        <label>
          Admin şifre
          <Input
            required
            minLength={8}
            type="password"
            value={form.firstAdmin.password}
            onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, password: event.target.value } })}
          />
        </label>
      ) : null}
    </FormModal>
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function tenantCreateErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.code === "TENANT_SLUG_ALREADY_EXISTS") {
    return "Bu slug zaten kullanımda. Farklı bir slug gir.";
  }
  return "Kurum oluşturulamadı.";
}

const tenantSortOptions = [
  { label: "Kurum A-Z", value: "name" },
  { label: "Kurum Z-A", value: "-name" },
  { label: "Slug A-Z", value: "slug" },
  { label: "Slug Z-A", value: "-slug" },
];
