"use client";

import type {
  GuardianRecord,
  GuardianStudentRecord,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
} from "@uzman-hocam/shared-types";

export function ProfilePanel({ profile }: { profile?: StudentProfileRecord }) {
  return (
    <section className="next-list-panel" aria-label="Profil">
      <h2>Profil</h2>
      <dl className="next-definition-list">
        <div>
          <dt>Ad soyad</dt>
          <dd>{profile ? `${profile.firstName} ${profile.lastName}` : "-"}</dd>
        </div>
        <div>
          <dt>Sınıf</dt>
          <dd>{profile?.className ?? profile?.classId ?? "-"}</dd>
        </div>
        <div>
          <dt>Kampüs</dt>
          <dd>{profile?.campusName ?? "-"}</dd>
        </div>
        <div>
          <dt>Seviye</dt>
          <dd>{profile?.gradeLevelName ?? "-"}</dd>
        </div>
        <div>
          <dt>Şube</dt>
          <dd>{profile?.section ?? "-"}</dd>
        </div>
        <div>
          <dt>Sorumlu öğretmen</dt>
          <dd>{profile?.responsibleTeacherName ?? profile?.responsibleTeacherId ?? "-"}</dd>
        </div>
        <div>
          <dt>TC</dt>
          <dd>{profile?.nationalIdMasked ?? "-"}</dd>
        </div>
        <div>
          <dt>Telefon</dt>
          <dd>{profile?.phone ?? "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function GuardianRelationsPanel({ guardians, links }: { guardians: GuardianRecord[]; links: GuardianStudentRecord[] }) {
  const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]));

  return (
    <section className="next-list-panel" aria-label="Veli ilişkileri">
      <h2>Veliler</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Veli</th>
            <th>İlişki</th>
            <th>Birincil</th>
            <th>İzinler</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const guardian = guardianById.get(link.guardianId);
            return (
              <tr key={link.id}>
                <td>{guardian ? `${guardian.firstName} ${guardian.lastName}` : link.guardianId}</td>
                <td>{guardianRelationshipLabel(link.relationshipType)}</td>
                <td>{link.isPrimary ? "Evet" : "Hayır"}</td>
                <td>{formatGuardianPermissions(link)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function StudentHistoryPanel({
  classHistory,
  enrollments,
  termNames,
}: {
  classHistory: StudentClassHistoryRecord[];
  enrollments: StudentEnrollmentRecord[];
  termNames: ReadonlyMap<string, string>;
}) {
  const rows = [
    ...classHistory.map((record) => ({
      id: `class-${record.id}`,
      type: "Sınıf",
      className: record.className ?? record.classId ?? "Sınıfsız",
      organization: formatClassOrganization(record),
      context: record.termId ? termNames.get(record.termId) ?? record.termId : "-",
      startsAt: record.startsAt,
      result: record.endsAt ? formatDate(record.endsAt) : "Devam ediyor",
      reason: formatEnrollmentReason(record.reason),
    })),
    ...enrollments.map((record) => ({
      id: `enrollment-${record.id}`,
      type: "Kayıt",
      className: record.className ?? record.classId ?? "Sınıfsız",
      organization: formatClassOrganization(record),
      context: record.termId ? termNames.get(record.termId) ?? record.termId : "-",
      startsAt: record.startsAt,
      result: record.endsAt ? `${formatStudentStatus(record.status)} / ${formatDate(record.endsAt)}` : formatStudentStatus(record.status),
      reason: formatEnrollmentReason(record.reason),
    })),
  ].sort((first, second) => second.startsAt.localeCompare(first.startsAt));

  return (
    <section className="next-list-panel" aria-label="Sınıf ve kayıt geçmişi">
      <h2>Sınıf ve Kayıt Geçmişi</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Tür</th>
            <th>Sınıf</th>
            <th>Organizasyon</th>
            <th>Dönem</th>
            <th>Başlangıç</th>
            <th>Durum</th>
            <th>Neden</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.type}</td>
              <td>{row.className}</td>
              <td>{row.organization}</td>
              <td>{row.context}</td>
              <td>{formatDate(row.startsAt)}</td>
              <td>{row.result}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function guardianRelationshipLabel(value: GuardianStudentRecord["relationshipType"]) {
  const labels: Record<GuardianStudentRecord["relationshipType"], string> = {
    EMERGENCY_CONTACT: "Acil kişi",
    FATHER: "Baba",
    GUARDIAN: "Vasi",
    MOTHER: "Anne",
    OTHER: "Diğer",
  };
  return labels[value];
}

function formatGuardianPermissions(link: GuardianStudentRecord) {
  const permissions = [
    link.canViewFinance ? "Finans" : undefined,
    link.canReceiveSms ? "SMS" : undefined,
    link.canReceiveAnnouncements ? "Duyuru" : undefined,
    link.canOpenSupportTickets ? "Destek" : undefined,
  ].filter((permission): permission is string => Boolean(permission));
  return permissions.length > 0 ? permissions.join(", ") : "-";
}

function formatClassOrganization(record: { campusName?: string; gradeLevelName?: string; section?: string }) {
  const parts = [record.campusName, record.gradeLevelName, record.section ? `${record.section} şube` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatEnrollmentReason(reason: string | undefined) {
  if (!reason) return "-";
  const labels: Record<string, string> = {
    CREATED: "İlk kayıt",
    MANUAL_CORRECTION: "Düzeltme",
    REASSIGNED: "Sınıf değişimi",
    TERM_ROLLOVER: "Dönem geçişi",
  };
  return labels[reason] ?? reason;
}

function formatStudentStatus(status: StudentEnrollmentRecord["status"]) {
  const labels: Record<StudentEnrollmentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}
