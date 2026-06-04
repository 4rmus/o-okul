"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@uzman-hocam/ui";
import type { ClassRecord, GuardianRecord, GuardianStudentRecord, StudentRecord } from "@uzman-hocam/shared-types";
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
                { label: "Aktif öğrenci", value: activeGuardianStudentCount(detail.links, detail.studentById) },
                { label: "Portal", value: detail.guardian.userId ? "Bağlı" : "Yok" },
              ]}
            />
            <section className="next-report-list" aria-label="Veli öğrenci bağlantıları">
              <h2>Öğrenciler</h2>
              {detail.links.length > 0 ? (
                <div className="next-relationship-list">
                  {detail.links.map((link) => {
                    const student = detail.studentById.get(link.studentId);
                    const studentName = detail.studentNameById.get(link.studentId) ?? link.studentId;
                    const className = student?.classId ? detail.classNameById.get(student.classId) ?? student.classId : "-";
                    const relationshipText = `${studentName} - ${formatRelationship(link.relationshipType)}${link.isPrimary ? " / Birincil" : ""}`;
                    return (
                      <article className="next-relationship-item" key={link.id}>
                        <header>
                          <div>
                            <h3>{relationshipText}</h3>
                            <p>{student?.studentNo ? `Öğrenci no ${student.studentNo}` : "Öğrenci no yok"}</p>
                          </div>
                          <span className="next-reference-badge">{link.isPrimary ? "Birincil" : "Ek bağlantı"}</span>
                        </header>
                        <dl className="next-definition-list">
                          <div>
                            <dt>Sınıf</dt>
                            <dd>{className}</dd>
                          </div>
                          <div>
                            <dt>Durum</dt>
                            <dd>{student ? formatStudentStatus(student.status) : "-"}</dd>
                          </div>
                          <div>
                            <dt>Portal</dt>
                            <dd>{student?.userId ? "Bağlı" : "Yok"}</dd>
                          </div>
                        </dl>
                        <div className="next-permission-row" aria-label={`${studentName} izinleri`}>
                          {permissionBadges(link).map((permission) => (
                            <span
                              className={permission.enabled ? "next-permission-badge next-permission-badge--enabled" : "next-permission-badge"}
                              key={permission.label}
                            >
                              {permission.label}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
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
  const [guardian, links, students, classes] = await Promise.all([
    apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/students`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
  ]);

  return {
    classNameById: new Map(classes.data.map((record) => [record.id, record.name])),
    guardian,
    links,
    students: students.data,
    studentById: new Map(students.data.map((record) => [record.id, record])),
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

function formatStudentStatus(status: StudentRecord["status"]) {
  const labels: Record<StudentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? status;
}

function activeGuardianStudentCount(
  links: GuardianStudentRecord[],
  studentById: ReadonlyMap<string, StudentRecord>,
) {
  return links.filter((link) => studentById.get(link.studentId)?.status === "ACTIVE").length;
}

function permissionBadges(link: GuardianStudentRecord) {
  return [
    { enabled: link.canViewFinance, label: "Ödeme" },
    { enabled: link.canReceiveSms, label: "SMS" },
    { enabled: link.canReceiveAnnouncements, label: "Duyuru" },
    { enabled: link.canOpenSupportTickets, label: "Destek" },
  ];
}
