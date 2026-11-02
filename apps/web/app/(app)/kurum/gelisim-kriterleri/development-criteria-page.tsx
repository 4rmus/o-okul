"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DevelopmentCriterionCreateRequest, DevelopmentCriterionRecord } from "@o-okul/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, type DataTableColumn } from "@o-okul/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";

interface CriterionForm {
  name: string;
  scaleMin: string;
  scaleMax: string;
  sortOrder: string;
}

const emptyForm: CriterionForm = { name: "", scaleMin: "1", scaleMax: "5", sortOrder: "0" };

// DEC-20261102-05: the criteria teachers score in a development assessment. The API has no edit or delete for a criterion.
export function DevelopmentCriteriaPage() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const queryKey = ["development-criteria", auth?.session.tenantId ?? "anonymous"];
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CriterionForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = auth ? hasCapabilityForRoles(auth.session.roles, "academic:manage") : false;
  const criteriaQuery = useQuery({
    queryKey,
    queryFn: () => apiRequest<DevelopmentCriterionRecord[]>(accessToken, `${apiBaseUrl}/development/criteria`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(
    () => [...(criteriaQuery.data ?? [])].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "tr")),
    [criteriaQuery.data],
  );

  const columns: Array<DataTableColumn<DevelopmentCriterionRecord>> = [
    { key: "name", header: "Kriter", mobilePriority: "primary", priority: "primary", render: (record) => record.name, sticky: "left" },
    { key: "scale", header: "Puan aralığı", mobilePriority: "secondary", priority: "secondary", render: (record) => `${record.scaleMin}–${record.scaleMax}` },
    { key: "sortOrder", align: "right", header: "Sıra", mobilePriority: "secondary", priority: "secondary", render: (record) => record.sortOrder },
  ];

  function openForm() {
    setForm(emptyForm);
    setFormError("");
    setIsFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scaleMin = Number(form.scaleMin);
    const scaleMax = Number(form.scaleMax);
    const sortOrder = Number(form.sortOrder || "0");
    if (!form.name.trim()) {
      setFormError("Kriter adı zorunludur.");
      return;
    }
    if (![scaleMin, scaleMax, sortOrder].every(Number.isInteger) || scaleMin >= scaleMax) {
      setFormError("Puanlar tam sayı olmalı; en düşük puan en yüksek puandan küçük olmalı.");
      return;
    }
    const body: DevelopmentCriterionCreateRequest = { name: form.name.trim(), scaleMin, scaleMax, sortOrder };
    setBusy(true);
    try {
      await apiRequest<DevelopmentCriterionRecord>(accessToken, `${apiBaseUrl}/development/criteria`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey });
      setIsFormOpen(false);
    } catch (error) {
      setFormError(apiErrorMessage(error, "Kriter kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CrudPage
        actions={canManage ? (
          <Button onClick={openForm}>
            <Plus size={17} aria-hidden="true" />
            Kriter ekle
          </Button>
        ) : undefined}
        aria-label="Gelişim kriteri yönetimi"
        columns={columns}
        density="compact"
        description="Öğretmenlerin gelişim değerlendirmesinde puan verdiği kriterler. Eklenen kriter sonradan değiştirilemez."
        emptyState={
          <EmptyState
            title="Gelişim kriteri yok"
            description={canManage
              ? "“Kriter ekle” ile odaklanma, sorumluluk gibi ilk kriteri tanımlayın."
              : "Kriterleri kurum yöneticisi tanımlar."}
          />
        }
        error={criteriaQuery.isError ? "Gelişim kriterleri alınamadı." : undefined}
        getRowKey={(record) => record.id}
        loading={criteriaQuery.isPending}
        rows={rows}
        tableCaption="Gelişim kriterleri"
        title="Gelişim kriterleri"
      />
      <FormModal
        onCancel={() => setIsFormOpen(false)}
        onClose={() => setIsFormOpen(false)}
        onSubmit={(event) => void submit(event)}
        open={isFormOpen}
        submitDisabled={busy}
        submitError={formError || undefined}
        submitLabel="Ekle"
        submitting={busy}
        title="Gelişim kriteri ekle"
      >
        <Field label="Kriter adı">
          <Input maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="En düşük puan">
          <Input inputMode="numeric" value={form.scaleMin} onChange={(event) => setForm({ ...form, scaleMin: event.target.value })} />
        </Field>
        <Field label="En yüksek puan">
          <Input inputMode="numeric" value={form.scaleMax} onChange={(event) => setForm({ ...form, scaleMax: event.target.value })} />
        </Field>
        <Field label="Sıra" description="Küçük sayı formda önce gelir.">
          <Input inputMode="numeric" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
        </Field>
      </FormModal>
    </>
  );
}
