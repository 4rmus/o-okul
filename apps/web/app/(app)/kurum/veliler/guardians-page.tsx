"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  type DataTableColumn,
  useConfirmDialog,
} from "@o-okul/ui";
import type { GuardianRecord } from "@o-okul/shared-types";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  guardianFormSchema,
  type GuardianFormPayload,
  type GuardianFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { RevealablePhone } from "../_shared/revealable-phone.js";

const emptyForm: GuardianFormState = {
  firstName: "",
  lastName: "",
  phone: "",
};

export function GuardiansPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: guardianSortOptions });
  const queryKey = ["next-guardians", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-guardians", auth?.session.tenantId ?? "anonymous"];
  const guardiansQuery = useQuery({
    queryKey,
    queryFn: () => loadGuardians(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingGuardian, setEditingGuardian] = useState<GuardianRecord | null>(null);
  const [form, setForm] = useState<GuardianFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = guardiansQuery.data?.data ?? [];
  const canRevealPhone = hasCapabilityForRoles(auth?.session.roles ?? [], "privacy:manage");
  const guardianPhoneReadyCount = rows.filter((guardian) => Boolean(guardian.phone)).length;
  const guardianPortalReadyCount = rows.filter((guardian) => Boolean(guardian.userId)).length;
  const guardianSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Veli toplamı",
      value: formatCount(guardiansQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada maskeli telefon",
      key: "phone",
      label: "Maskeli iletişim",
      tone: guardianPhoneReadyCount > 0 ? "info" : "warning",
      value: `${guardianPhoneReadyCount}/${rows.length}`,
    },
    {
      description: "Mevcut veli erişimi bağlı",
      key: "portal",
      label: "Mevcut veli erişimi",
      tone: guardianPortalReadyCount > 0 ? "success" : "default",
      value: `${guardianPortalReadyCount}/${rows.length}`,
    },
    {
      description: "Liste ve ekran görüntülerinde kişisel bilgiler korunur",
      key: "pii",
      label: "Kişisel bilgiler",
      tone: "success",
      value: "Maskeli",
    },
  ];
  const guardianSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "phone",
      label: "Telefon varsayılan maskeli",
      tone: "success",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatGuardianSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];
  const guardianSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Liste telefonları varsayılan maskeli tutar",
      key: "masked-contact",
      label: "İletişim temizliği",
      status: guardianPhoneReadyCount === rows.length && rows.length > 0 ? "Hazır" : "Kontrol",
      tone: guardianPhoneReadyCount > 0 ? "success" : "warning",
      value: `${guardianPhoneReadyCount}/${rows.length}`,
    },
    {
      detail: "Mevcut veli hesabı bağlantısı",
      key: "portal-link",
      label: "Veli erişimi",
      status: guardianPortalReadyCount > 0 ? "Bağlı" : "Bekliyor",
      tone: guardianPortalReadyCount > 0 ? "success" : "neutral",
      value: `${guardianPortalReadyCount}/${rows.length}`,
    },
    {
      detail: "Seçilen sıralama korunur",
      key: "sort-context",
      label: "Liste sırası",
      status: "Liste",
      tone: "neutral",
      value: formatGuardianSort(listQuery.sort),
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<GuardianRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      sticky: "left",
      render: (guardian) => `${guardian.firstName} ${guardian.lastName}`,
    },
    {
      key: "phone",
      header: "İletişim",
      priority: "secondary",
      render: (guardian) => <RevealablePhone canReveal={canRevealPhone} value={guardian.phone} />,
    },
    {
      key: "actions",
      header: "İşlem",
      align: "center",
      priority: "primary",
      sticky: "right",
      render: (guardian) => (
        <span className="next-row-actions">
          <Link href={`/kurum/veliler/${encodeURIComponent(guardian.id)}`} aria-label={`${guardian.firstName} detay`}>
            <Eye size={17} aria-hidden="true" />
          </Link>
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(guardian)} aria-label={`${guardian.firstName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(guardian)} aria-label={`${guardian.firstName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingGuardian(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(guardian: GuardianRecord) {
    setEditingGuardian(guardian);
    setForm({
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      phone: guardian.phone ?? "",
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingGuardian(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = guardianFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedGuardian = editingGuardian
        ? await updateGuardian(auth.accessToken, editingGuardian.id, parsedForm.data)
        : await createGuardian(auth.accessToken, parsedForm.data);
      void savedGuardian;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Veli kaydedilemedi.");
    }
  }

  async function handleDelete(guardian: GuardianRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${guardian.firstName} ${guardian.lastName} velisi silinsin mi?`,
      title: "Veliyi sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteGuardian(auth.accessToken, guardian.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Veli silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={guardiansQuery.data?.meta}
              onChange={setListQuery}
              searchPlaceholder="Ad veya soyad ara"
              sortOptions={guardianSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Veli ekle
            </Button>
          </>
        }
        aria-label="Veli yönetimi"
        columns={columns}
        density="compact"
        description="Veli kayıtlarını ve öğrenci bağlantılarını yönetin. İletişim bilgileri listede maskeli gösterilir."
        emptyState={
          <EmptyState
            title="Veli kaydı yok"
            description="Henüz görüntülenecek veli kaydı yok."
            hint="Yeni veli kaydı ekleyebilirsiniz."
            primaryAction={{ label: "Veli ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Veli kaydı yok"
        error={error || (guardiansQuery.isError ? "Veliler alınamadı." : undefined)}
        getRowKey={(guardian) => guardian.id}
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={guardiansQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={guardianSummaryActions}
            ariaLabel="Veli kayıt özeti"
            badges={guardianSummaryBadges}
            items={guardianSummaryItems}
          />
        }
        tableCaption="Veli kayıt listesi"
        tableDescription="Ad soyad, maskeli iletişim durumu ve veli aksiyonları."
        title="Veliler"
      />
      <FormModal
        description="Ad ve soyad alanları zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingGuardian ? "Kaydet" : "Ekle"}
        title={editingGuardian ? "Veli düzenle" : "Veli ekle"}
      >
        <div className="next-guardian-form-grid">
          <Field label="Ad">
            <Input
              required
              value={form.firstName}
              onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
            />
          </Field>
          <Field label="Soyad">
            <Input
              required
              value={form.lastName}
              onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
            />
          </Field>
          <Field label="Telefon" description="Tam telefon yalnız kayıt formunda ve detay akışlarında gösterilir. Liste görünümünde maskelenir.">
            <Input
              value={form.phone ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Field>
        </div>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const guardianSortOptions = [
  { label: "Ad A-Z", value: "firstName" },
  { label: "Ad Z-A", value: "-firstName" },
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
];

async function loadGuardians(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<GuardianRecord>(accessToken, buildListUrl(`${apiBaseUrl}/guardians`, listQuery));
}

async function createGuardian(accessToken: string, input: GuardianFormPayload) {
  return apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateGuardian(accessToken: string, id: string, input: GuardianFormPayload) {
  return apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteGuardian(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("GUARDIAN_DELETE_FAILED");
  }
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatGuardianSort(value: string) {
  return guardianSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
