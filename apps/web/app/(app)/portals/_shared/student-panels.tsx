"use client";

import { DataTable, InfoGrid, InfoItem, Panel, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import type {
  GuardianRecord,
  GuardianStudentRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
} from "@o-okul/shared-types";
import { isSmsEnabled } from "../../../../src/sms-feature.js";

export function StudentFocusPanel({
  announcementStatus,
  attendanceStatus,
  financeStatus,
  homeworkStatus,
  mode,
  net,
  profile,
  questionCount,
  scopeLabel,
  successRate,
  supportStatus,
}: {
  announcementStatus: string;
  attendanceStatus: string;
  financeStatus?: string;
  homeworkStatus: string;
  mode: "guardian" | "read-only" | "student";
  net: string;
  profile?: StudentProfileRecord;
  questionCount: string;
  scopeLabel: string;
  successRate: string;
  supportStatus: string;
}) {
  const studentName = profile ? `${profile.firstName} ${profile.lastName}` : "-";
  const className = profile?.className ?? "Sınıf bilgisi yok";
  const details = [
    { label: "Görünüm", value: scopeLabel },
    { label: "Duyuru", value: announcementStatus },
    { label: "Ödev", value: homeworkStatus },
    { label: "Devamsızlık", value: attendanceStatus },
    { label: "Destek", value: supportStatus },
    ...(financeStatus ? [{ label: "Ödeme planları", value: financeStatus }] : []),
    { label: "Başarı %", value: successRate },
    { label: "Soru", value: questionCount },
    { label: "Net", value: net },
  ];

  return (
    <Panel
      actions={<StatusBadge tone={mode === "read-only" ? "neutral" : "info"}>{studentFocusModeLabel(mode)}</StatusBadge>}
      aria-label="Seçili öğrenci özeti"
      className="next-portal-focus"
      description="Seçili öğrencinin sınıf ve sonuç özeti"
      title="Seçili Öğrenci"
    >
      <div className="next-portal-focus__body">
        <div className="next-portal-focus__identity">
          <span>Öğrenci</span>
          <strong>{studentName}</strong>
          <small>{className}</small>
        </div>
        <InfoGrid className="next-portal-focus__grid" aria-label="Seçili öğrenci bilgileri" role="region">
          {details.map((item) => (
            <InfoItem key={item.label} label={item.label} value={item.value} />
          ))}
        </InfoGrid>
      </div>
    </Panel>
  );
}

export function ProfilePanel({ profile }: { profile?: StudentProfileRecord }) {
  return (
    <Panel
      aria-label="Profil"
      description="Öğrencinin portaldaki güvenli profil özeti."
      title="Profil"
    >
      <InfoGrid className="next-portal-profile-info" aria-label="Portal öğrenci profil özeti" role="region">
        <InfoItem label="Ad soyad" value={profile ? `${profile.firstName} ${profile.lastName}` : "-"} />
        <InfoItem label="Sınıf" value={profile?.className ?? "Sınıf bilgisi yok"} />
        <InfoItem label="Kampüs" value={profile?.campusName ?? "-"} />
        <InfoItem label="Seviye" value={profile?.gradeLevelName ?? "-"} />
        <InfoItem label="Şube" value={profile?.section ?? "-"} />
        <InfoItem label="Sorumlu öğretmen" value={profile?.responsibleTeacherName ?? "Öğretmen bilgisi yok"} />
        <InfoItem label="TC" value={profile?.nationalIdMasked ?? "-"} />
        <InfoItem label="Telefon" value={profile?.phone ? maskPhoneNumber(profile.phone) : "-"} />
      </InfoGrid>
    </Panel>
  );
}

export function GuardianRelationsPanel({ guardians, links }: { guardians: GuardianRecord[]; links: GuardianStudentRecord[] }) {
  const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]));
  const columns: Array<DataTableColumn<GuardianStudentRecord>> = [
    {
      header: "Veli",
      key: "guardian",
      priority: "primary",
      render: (link) => {
        const guardian = guardianById.get(link.guardianId);
        return guardian ? `${guardian.firstName} ${guardian.lastName}` : "Bilinmeyen veli";
      },
      sticky: "left",
    },
    {
      header: "İzinler",
      key: "permissions",
      priority: "secondary",
      render: (link) => formatGuardianPermissions(link),
    },
  ];

  return (
    <Panel
      aria-label="Veli ilişkileri"
      description="Öğrenciye bağlı veli ilişkileri ve portaldaki izin kapsamları."
      title="Veliler"
    >
      <DataTable
        caption="Veli ilişkileri"
        columns={columns}
        description="Öğrenciye bağlı veli ilişkileri ve portaldaki izin kapsamları."
        emptyText="Bağlı veli yok."
        getRowKey={(link) => link.id}
        rows={links}
      />
    </Panel>
  );
}

export function StudentHistoryPanel({
  enrollments,
  termNames,
}: {
  enrollments: StudentEnrollmentRecord[];
  termNames: ReadonlyMap<string, string>;
}) {
  const rows = enrollments
    .map((record) => ({
      id: `enrollment-${record.id}`,
      className: record.className ?? "Sınıf bilgisi yok",
      organization: formatClassOrganization(record),
      context: record.termId ? termNames.get(record.termId) ?? "Dönem bilgisi yok" : "-",
      startsAt: record.startsAt,
      result: record.endsAt ? `${formatStudentStatus(record.status)} / ${formatDate(record.endsAt)}` : formatStudentStatus(record.status),
      reason: formatEnrollmentReason(record.reason),
    }))
    .sort((first, second) => second.startsAt.localeCompare(first.startsAt));
  const columns: Array<DataTableColumn<(typeof rows)[number]>> = [
    {
      header: "Sınıf",
      key: "class",
      priority: "primary",
      render: (row) => row.className,
      sticky: "left",
    },
    {
      header: "Organizasyon",
      key: "organization",
      priority: "optional",
      render: (row) => row.organization,
    },
    {
      header: "Dönem",
      key: "term",
      priority: "secondary",
      render: (row) => row.context,
    },
    {
      header: "Başlangıç",
      key: "startsAt",
      priority: "secondary",
      render: (row) => formatDate(row.startsAt),
    },
    {
      header: "Durum",
      key: "result",
      priority: "primary",
      render: (row) => row.result,
    },
    {
      header: "Neden",
      key: "reason",
      priority: "optional",
      render: (row) => row.reason,
    },
  ];

  return (
    <Panel
      aria-label="Sınıf ve kayıt geçmişi"
      description="Sınıf hareketleri, kayıt dönemleri ve aktif öğrenci durumu."
      title="Sınıf ve Kayıt Geçmişi"
    >
      <DataTable
        caption="Sınıf ve kayıt geçmişi"
        columns={columns}
        description="Sınıf hareketleri, kayıt dönemleri ve aktif öğrenci durumu."
        density="compact"
        emptyText="Sınıf veya kayıt geçmişi yok."
        getRowKey={(row) => row.id}
        rows={rows}
      />
    </Panel>
  );
}

function studentFocusModeLabel(mode: "guardian" | "read-only" | "student") {
  if (mode === "read-only") return "Yalnızca görüntüleme";
  if (mode === "guardian") return "Veli görünümü";
  return "Öğrenci hesabı";
}

function formatGuardianPermissions(link: GuardianStudentRecord) {
  const permissions = [
    link.canViewFinance ? "Ödeme planları" : undefined,
    isSmsEnabled && link.canReceiveSms ? "SMS" : undefined,
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
  return labels[reason] ?? "Neden bilgisi yok";
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

function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  const suffix = digits.slice(-2).padStart(2, "•");
  return `••• ••• ••${suffix}`;
}
