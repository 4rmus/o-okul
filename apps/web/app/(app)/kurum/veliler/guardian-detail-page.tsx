"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@uzman-hocam/ui";
import type { GuardianRecord, GuardianStudentRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft, Link2, Send } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

const emptyLinkForm = {
  isPrimary: true,
  relationshipType: "GUARDIAN" as GuardianStudentRecord["relationshipType"],
  studentId: "",
};

export function GuardianDetailPage({ guardianId }: { guardianId: string }) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const detailQuery = useQuery({
    queryKey: ["next-guardian-detail", tenantId, guardianId],
    queryFn: () => loadGuardianDetail(auth?.accessToken ?? "", guardianId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [linkError, setLinkError] = useState("");
  const detail = detailQuery.data;
  const guardianName = detail ? `${detail.guardian.firstName} ${detail.guardian.lastName}` : "Veli detayı";
  const linkedStudentIds = useMemo(() => new Set((detail?.links ?? []).map((link) => link.studentId)), [detail?.links]);
  const availableStudents = (detail?.students ?? []).filter((student) => !linkedStudentIds.has(student.id));

  async function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !linkForm.studentId) return;

    setLinkError("");
    try {
      await linkGuardianStudent(auth.accessToken, guardianId, linkForm);
      setLinkForm(emptyLinkForm);
      void queryClient.invalidateQueries({ queryKey: ["next-guardian-detail", tenantId, guardianId] });
      void queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] });
    } catch {
      setLinkError("Öğrenci bağlantısı kurulamadı.");
    }
  }

  return (
    <PageFrame
      title={guardianName}
      subtitle="Veli detayı"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/veliler">
          <ArrowLeft size={17} aria-hidden="true" />
          Velilere dön
        </Link>
      }
    >
      <section className="next-report-panel" aria-label="Veli detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Veli detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <MetricPanelGrid
              ariaLabel="Veli özeti"
              metrics={[
                { label: "Telefon", value: detail.guardian.phone ?? "-" },
                { label: "Öğrenci bağlantısı", value: detail.links.length },
                { label: "Portal", value: detail.guardian.userId ? "Bağlı" : "Yok" },
              ]}
            />
            <section className="next-report-list" aria-label="Veli öğrenci bağlantıları">
              <h2>Öğrenciler</h2>
              {detail.links.length > 0 ? (
                detail.links.map((link) => (
                  <p key={link.id}>
                    {detail.studentNameById.get(link.studentId) ?? link.studentId} - {formatRelationship(link.relationshipType)}
                    {link.isPrimary ? " / Birincil" : ""}
                  </p>
                ))
              ) : (
                <p>Öğrenci bağlantısı yok</p>
              )}
            </section>
            <section className="next-report-list" aria-label="Veli öğrenci bağı ekle">
              <h2>Öğrenci bağla</h2>
              <form onSubmit={(event) => void handleLinkSubmit(event)}>
                <label>
                  Öğrenci
                  <select
                    required
                    value={linkForm.studentId}
                    onChange={(event) => setLinkForm((current) => ({ ...current, studentId: event.target.value }))}
                  >
                    <option value="">Seç</option>
                    {availableStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.firstName} {student.lastName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  İlişki
                  <select
                    value={linkForm.relationshipType}
                    onChange={(event) =>
                      setLinkForm((current) => ({
                        ...current,
                        relationshipType: event.target.value as GuardianStudentRecord["relationshipType"],
                      }))
                    }
                  >
                    <option value="GUARDIAN">Vasi</option>
                    <option value="MOTHER">Anne</option>
                    <option value="FATHER">Baba</option>
                    <option value="EMERGENCY_CONTACT">Acil kişi</option>
                    <option value="OTHER">Diğer</option>
                  </select>
                </label>
                <label>
                  <input
                    checked={linkForm.isPrimary}
                    onChange={(event) => setLinkForm((current) => ({ ...current, isPrimary: event.target.checked }))}
                    type="checkbox"
                  />
                  Birincil veli
                </label>
                {linkError ? <p className="uh-crud-page__error">{linkError}</p> : null}
                <Button disabled={availableStudents.length === 0} type="submit">
                  <Link2 size={17} aria-hidden="true" />
                  Bağla
                </Button>
              </form>
            </section>
            <section className="next-report-list" aria-label="Veli portal daveti">
              <h2>Portal daveti</h2>
              <Link className="uh-button uh-button--secondary" href={`/kurum/kullanicilar?invite=guardian&subjectId=${encodeURIComponent(guardianId)}`}>
                <Send size={17} aria-hidden="true" />
                Portal daveti gönder
              </Link>
            </section>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadGuardianDetail(accessToken: string, guardianId: string) {
  const [guardian, links, students] = await Promise.all([
    apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/students`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
  ]);

  return {
    guardian,
    links,
    students: students.data,
    studentNameById: new Map(students.data.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
  };
}

async function linkGuardianStudent(
  accessToken: string,
  guardianId: string,
  input: typeof emptyLinkForm,
) {
  return apiRequest<GuardianStudentRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/students`, {
    body: JSON.stringify({
      canOpenSupportTickets: true,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: true,
      isPrimary: input.isPrimary,
      relationshipType: input.relationshipType,
      studentId: input.studentId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function formatRelationship(value: GuardianStudentRecord["relationshipType"]) {
  if (value === "MOTHER") return "Anne";
  if (value === "FATHER") return "Baba";
  if (value === "GUARDIAN") return "Vasi";
  if (value === "EMERGENCY_CONTACT") return "Acil kişi";
  return "Diğer";
}
