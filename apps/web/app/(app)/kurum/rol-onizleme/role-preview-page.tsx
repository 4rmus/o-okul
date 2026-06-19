"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Field, MetricCard, MetricGrid, Panel, Select, StatusBadge, type DataTableColumn } from "@uzman-hocam/ui";
import {
  tenantAssignableRoles,
  tenantRoleLabel,
  type GuardianRecord,
  type PortalSubjectRoleName,
  type StudentRecord,
  type TenantAssignableRoleName,
  type TeacherRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { getInstitutionNavGroups, hasInstitutionAccess } from "../../_shared/access.js";
import { OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { storeRolePreviewToken } from "../../portals/_shared/portal-shell.js";

type PreviewRole = TenantAssignableRoleName;

const roleCards = [
  {
    title: "Öğretmen Portalı",
    route: "/ogretmen",
    account: "TEACHER + subjectType TEACHER",
    scope: "Ders programı, kapsamındaki öğrenciler, yoklama, not, ödev kontrolü ve raporlar",
    subjectScope: "Öğretmen kişi kaydı",
    dataScope: "/me/teacher ve öğretmen kapsamlı öğrenci verisi",
    writePolicy: "Yazma aksiyonları kapalı",
    targetRole: "TEACHER",
  },
  {
    title: "Öğrenci Portalı",
    route: "/ogrenci",
    account: "STUDENT + subjectType STUDENT",
    scope: "Profil, devamsızlık, duyuru, ödev, destek talebi, sınav raporu ve hata kitapçığı",
    subjectScope: "Öğrenci kişi kaydı",
    dataScope: "/me/student ve kendi öğrenci kapsamı",
    writePolicy: "Destek ve profil yazma aksiyonları kapalı",
    targetRole: "STUDENT",
  },
  {
    title: "Veli Portalı",
    route: "/veli",
    account: "GUARDIAN + subjectType GUARDIAN",
    scope: "Bağlı öğrenci, ödeme görünümü, bildirim tercihleri, duyuru, destek ve raporlar",
    subjectScope: "Veli kişi kaydı",
    dataScope: "/me/guardian bağlı öğrenci kapsamı",
    writePolicy: "Finans izni ve yazma aksiyonları salt-okuma",
    targetRole: "GUARDIAN",
  },
] as const;

const accessRules = [
  "Kurum admin portalları normal sol menü rotası olarak görmez.",
  "Portal route'u kişi hesabı ve doğru subjectType ister.",
  "Veli yalnız bağlı öğrencinin verisini görür.",
  "Öğretmen yalnız sorumlu öğrenci veya ders programı kapsamını görür.",
  "Öğrenci yalnız kendi /me/student verisini görür.",
] as const;

const evidenceChecks = [
  "pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g \"Next rol portalları bağlı kişi verisini gösterir\"",
  "pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts",
  "pnpm identity-link:audit",
] as const;

const previewRoles = tenantAssignableRoles.map((role) => ({ label: tenantRoleLabel(role), value: role }));

const rolePreviewMetrics = [
  { description: "Öğretmen, öğrenci ve veli portalı", key: "portal", label: "Portal", tone: "info", value: "3 rol" },
  { description: "Kişi hesabı ve subjectType zorunlu", key: "access", label: "Erişim", tone: "success", value: "Kişi hesabı" },
  { description: "Portal sorguları /me kapsamından ilerler", key: "scope", label: "Kapsam", tone: "default", value: "/me bağlı" },
] as const;

interface RolePreviewSession {
  id: string;
  targetRole: PortalSubjectRoleName;
  targetSubjectId: string;
  mode: "READ_ONLY";
  expiresAt: string;
  previewToken: string;
}

interface PreviewProfile {
  userId: string;
  roles: string[];
  subjectType?: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectId?: string;
}

interface PortalProbe {
  label: string;
  value: string;
}

interface PreviewSubjectOption {
  description: string;
  id: string;
  label: string;
}

type PreviewSubjectOptions = Record<RolePreviewSession["targetRole"], PreviewSubjectOption[]>;

interface RolePreviewScopeRow {
  group: string;
  id: string;
  item: string;
}

interface RolePreviewMetaRow {
  id: string;
  label: string;
  value: string;
}

interface RolePreviewListRow {
  id: string;
  value: string;
}

const rolePreviewScopeColumns: Array<DataTableColumn<RolePreviewScopeRow>> = [
  {
    key: "group",
    header: "Kapsam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.group,
  },
  {
    key: "item",
    header: "Görünür öğe",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => formatRolePreviewScopeValue(row.item),
  },
];

const rolePreviewMetaColumns: Array<DataTableColumn<RolePreviewMetaRow>> = [
  {
    key: "label",
    header: "Alan",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.label,
  },
  {
    key: "value",
    header: "Kapsam",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.value,
  },
];

const rolePreviewListColumns: Array<DataTableColumn<RolePreviewListRow>> = [
  {
    key: "value",
    header: "Kontrol",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => formatRolePreviewScopeValue(row.value),
  },
];

const emptyPreviewSubjects: PreviewSubjectOptions = {
  GUARDIAN: [],
  STUDENT: [],
  TEACHER: [],
};

export function RolePreviewPage() {
  const { auth } = useAuth();
  const [error, setError] = useState("");
  const [session, setSession] = useState<RolePreviewSession | null>(null);
  const [profile, setProfile] = useState<PreviewProfile | null>(null);
  const [portalProbe, setPortalProbe] = useState<PortalProbe | null>(null);
  const [previewRole, setPreviewRole] = useState<PreviewRole>("TENANT_ADMIN");
  const [pendingRole, setPendingRole] = useState<RolePreviewSession["targetRole"] | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Record<RolePreviewSession["targetRole"], string>>({
    GUARDIAN: "",
    STUDENT: "",
    TEACHER: "",
  });
  const previewSections = buildRolePreviewSections(previewRole);
  const previewSubjectsQuery = useQuery({
    queryKey: ["next-role-preview-subjects", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadPreviewSubjects(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const previewSubjects = previewSubjectsQuery.data ?? emptyPreviewSubjects;
  const previewScopeRows = buildRolePreviewScopeRows(previewSections);
  const rolePreviewSummaryItems: OperationSummaryItem[] = [
    {
      description: "Öğretmen, öğrenci ve veli portal kapsamı",
      key: "portal-scope",
      label: "Portal kapsamı",
      tone: "info",
      value: `${roleCards.length} rol`,
    },
    {
      description: "Önizleme oturumu yazma işlemlerini kapatır",
      key: "mode",
      label: "Mod",
      tone: "success",
      value: "READ_ONLY",
    },
    {
      description: "Preview token route query veya ekranda gösterilmez",
      key: "token",
      label: "Token",
      tone: "success",
      value: "URL'de yok",
    },
    {
      description: "Backend audit kaydı süreli preview context üretir",
      key: "audit",
      label: "Audit",
      tone: "info",
      value: "Süreli kayıt",
    },
  ];
  const rolePreviewSummaryBadges: OperationSummaryBadge[] = [
    { key: "readonly", label: "Yazma kapalı", tone: "success" },
    { key: "scope", label: "/me bağlı veri", tone: "info" },
    { key: "pii", label: "Demo PII gizli", tone: "neutral" },
  ];
  const rolePreviewSummaryActions: OperationSummaryAction[] = [
    {
      detail: "POST /role-previews yalnız seçili kişi kaydıyla çağrılır",
      key: "preview-start",
      label: "Preview başlat",
      status: "Auditli",
      tone: "info",
      value: "Server kayıt",
    },
    {
      detail: "Preview token ekranda, URL'de veya breadcrumb metninde gösterilmez",
      key: "token-safe",
      label: "Token taşıma",
      status: "SessionStorage",
      tone: "success",
      value: "Gizli",
    },
    {
      detail: "Portal context /me probe ile doğrulanır",
      key: "portal-probe",
      label: "Portal probe",
      status: "READ_ONLY",
      tone: "success",
      value: "/me",
    },
  ];

  useEffect(() => {
    setSelectedSubjectIds((current) => ({
      GUARDIAN: selectedSubjectIdOrFirst(current.GUARDIAN, previewSubjects.GUARDIAN),
      STUDENT: selectedSubjectIdOrFirst(current.STUDENT, previewSubjects.STUDENT),
      TEACHER: selectedSubjectIdOrFirst(current.TEACHER, previewSubjects.TEACHER),
    }));
  }, [previewSubjects]);

  async function previewAs(targetRole: RolePreviewSession["targetRole"], targetSubjectId: string) {
    setError("");
    setProfile(null);
    setPortalProbe(null);
    try {
      if (!auth) return;
      setPendingRole(targetRole);
      const previewSession = await apiRequest<RolePreviewSession>(auth.accessToken, `${apiBaseUrl}/role-previews`, {
        body: JSON.stringify({ targetRole, targetSubjectId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const previewProfile = await apiRequest<PreviewProfile>(auth.accessToken, `${apiBaseUrl}/me/profile`, {
        headers: { "x-role-preview-token": previewSession.previewToken },
      });
      const previewPortalProbe = await loadPortalProbe(auth.accessToken, previewSession);
      setSession(previewSession);
      setProfile(previewProfile);
      setPortalProbe(previewPortalProbe);
    } catch (previewError) {
      setError(apiErrorMessage(previewError, "Rol önizleme başlatılamadı."));
    } finally {
      setPendingRole(null);
    }
  }

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Rol Önizleme"
      subtitle="Kurum admin için öğretmen, öğrenci ve veli portal kapsamlarını güvenli şekilde izle."
    >
      <MetricGrid aria-label="Rol önizleme özeti" role="region">
        {rolePreviewMetrics.map((metric) => (
          <MetricCard
            description={metric.description}
            key={metric.key}
            label={metric.label}
            tone={metric.tone}
            value={metric.value}
          />
        ))}
      </MetricGrid>
      <OperationSummary
        actions={rolePreviewSummaryActions}
        ariaLabel="Rol önizleme operasyon özeti"
        badges={rolePreviewSummaryBadges}
        items={rolePreviewSummaryItems}
      />
      <OperationDecisionNotice
        decision="Karar: panel audit'li ve süreli rol önizleme kaydı başlatır."
        reason="Gerçek kullanıcı kapsamına geçiş salt-okunur ve denetlenebilir önizleme kaydı olmadan açılmaz."
        nextStep="Preview tokenı /me portal sorgularında salt-okuma context olarak kullanılır."
      />
      {error ? <p className="next-form-error">{error}</p> : null}
      {previewSubjectsQuery.isError ? <p className="next-form-error">Önizleme kişileri yüklenemedi.</p> : null}
      {session ? (
        <Panel
          aria-label="Aktif rol önizleme kaydı"
          className="next-role-preview-active"
          description="Preview token ekranda veya URL'de gösterilmez; portal linki salt-okuma context'i oturum saklama alanı üzerinden taşır."
          title="Aktif Önizleme"
        >
          <div className="next-role-preview-badges" aria-label="Aktif önizleme güven durumu">
            <StatusBadge tone="success">Salt-okuma</StatusBadge>
            <StatusBadge tone={profile ? "success" : "warning"}>
              {profile ? "Portal context doğrulandı" : "Portal context bekleniyor"}
            </StatusBadge>
            <StatusBadge tone="info">Süreli oturum</StatusBadge>
          </div>
          <div className="next-role-preview-session-grid">
            <p>Hedef rol: {session.targetRole}</p>
            <p>Kişi kaydı: {subjectPrivacyLabel(session.targetRole)}</p>
            <p>Mod: {session.mode}</p>
            <p>Bitiş: {new Date(session.expiresAt).toLocaleString("tr-TR")}</p>
            {profile ? (
              <>
                <p>Portal context doğrulandı</p>
                <p>Context rol: {profile.roles.join(", ")}</p>
                <p>Context kişi tipi: {profile.subjectType}</p>
                <p>Context kişi kaydı: {profile.subjectId ? "Maskeli subject ref" : "Bekleniyor"}</p>
              </>
            ) : null}
            {portalProbe ? (
              <p>
                {portalProbe.label}: {portalProbe.value}
              </p>
            ) : null}
          </div>
          <Link className="uh-button uh-button--primary uh-button--md" href={buildPortalPreviewHref(session)} onClick={() => storeRolePreviewToken(session.previewToken)}>
            {portalPreviewLabel(session.targetRole)}
          </Link>
        </Panel>
      ) : null}
      <Panel
        aria-label="Rol görünüm önizleme"
        className="next-role-preview-scope-panel"
        description="Seçili rolün görebileceği kurum menüsü veya portal rotası."
        title="Görünüm Önizleme"
      >
        <Field label="Rol" description="Seçili rol için kurum menüsü veya portal rotası kapsamını gösterir.">
          <Select value={previewRole} onChange={(event) => setPreviewRole(event.target.value as PreviewRole)}>
            {previewRoles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
        </Field>
        <DataTable
          caption="Rol görünüm kapsamı"
          columns={rolePreviewScopeColumns}
          density="compact"
          description="Kurum rolleri menü öğelerini, portal rolleri yalnız ilgili portal rotasını gösterir."
          emptyText="Rol kapsamı yok"
          getRowKey={(row) => row.id}
          rows={previewScopeRows}
        />
      </Panel>
      <section className="next-role-preview-portal-grid" aria-label="Rol portal kartları" aria-busy={Boolean(pendingRole)}>
        <header className="next-role-preview-section-header">
          <h2>Portal Kapsamları</h2>
          <p>Portal önizlemeleri auditli ve salt-okuma context ile başlatılır.</p>
        </header>
        <div className="next-role-preview-card-grid">
          {roleCards.map((role) => {
            const subjectOptions = previewSubjects[role.targetRole];
            const selectedSubjectId = selectedSubjectIds[role.targetRole] || subjectOptions[0]?.id || "";
            const selectedSubject = subjectOptions.find((subject) => subject.id === selectedSubjectId);
            const subjectSelectDescription = selectedSubject
              ? selectedSubject.description
              : previewSubjectsQuery.isLoading
                ? "Kurum kayıtları yükleniyor."
                : "Önizleme için uygun kişi kaydı bulunamadı.";

            return (
              <Panel
                actions={
                  <div className="next-role-preview-badges" aria-label={`${role.title} güven durumu`}>
                    <StatusBadge tone="success">Salt-okuma</StatusBadge>
                    <StatusBadge tone="info">Auditli</StatusBadge>
                    <StatusBadge tone="neutral">Kişi kapsamı</StatusBadge>
                  </div>
                }
                aria-label={`${role.title} kapsam kartı`}
                as="article"
                className="next-role-preview-card"
                description={role.scope}
                key={role.title}
                title={role.title}
              >
                <div className="next-role-preview-card__body">
                  <p>{role.account}</p>
                  <code className="next-role-preview-route">{role.route}</code>
                  <DataTable
                    caption={`${role.title} kapsam özeti`}
                    columns={rolePreviewMetaColumns}
                    density="compact"
                    getRowKey={(row) => row.id}
                    rows={buildRolePreviewMetaRows(role)}
                  />
                  <p>Demo hesap bilgisi görünüm kanıtlarında gösterilmez.</p>
                  <Field label="Önizleme kişisi" description={subjectSelectDescription}>
                    <Select
                      value={selectedSubjectId}
                      disabled={previewSubjectsQuery.isLoading || subjectOptions.length === 0}
                      onChange={(event) =>
                        setSelectedSubjectIds((current) => ({
                          ...current,
                          [role.targetRole]: event.target.value,
                        }))
                      }
                    >
                      {subjectOptions.length === 0 ? <option value="">Kayıt bekleniyor</option> : null}
                      {subjectOptions.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={Boolean(pendingRole) || !selectedSubjectId}
                    onClick={() => void previewAs(role.targetRole, selectedSubjectId)}
                  >
                    {pendingRole === role.targetRole
                      ? "Önizleme hazırlanıyor"
                      : `Auditli ${role.title.replace(" Portalı", "").toLocaleLowerCase("tr-TR")} önizleme başlat`}
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      </section>
      <RolePreviewList title="Erişim Kuralları" ariaLabel="Rol erişim kuralları" items={accessRules} />
      <RolePreviewList title="Kanıt Komutları" ariaLabel="Rol önizleme kanıt komutları" items={evidenceChecks} />
    </PageFrame>
  );
}

async function loadPreviewSubjects(accessToken: string): Promise<PreviewSubjectOptions> {
  const [teachers, students, guardians] = await Promise.all([
    apiListRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/teachers`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians`),
  ]);

  return {
    GUARDIAN: buildPreviewSubjectOptions(guardians.data, "GUARDIAN"),
    STUDENT: buildPreviewSubjectOptions(students.data, "STUDENT"),
    TEACHER: buildPreviewSubjectOptions(teachers.data, "TEACHER"),
  };
}

function buildPreviewSubjectOptions(records: Array<{ id: string }>, role: RolePreviewSession["targetRole"]): PreviewSubjectOption[] {
  return records.map((record, index) => ({
    description: previewSubjectDescription(role),
    id: record.id,
    label: `${previewSubjectLabel(role)} ${index + 1}`,
  }));
}

function previewSubjectLabel(role: RolePreviewSession["targetRole"]): string {
  const labels: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "Veli kaydı",
    STUDENT: "Öğrenci kaydı",
    TEACHER: "Öğretmen kaydı",
  };
  return labels[role];
}

function previewSubjectDescription(role: RolePreviewSession["targetRole"]): string {
  const descriptions: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "Maskeli veli referansı",
    STUDENT: "Maskeli öğrenci referansı",
    TEACHER: "Maskeli öğretmen referansı",
  };
  return descriptions[role];
}

function selectedSubjectIdOrFirst(currentId: string, options: PreviewSubjectOption[]): string {
  if (options.some((option) => option.id === currentId)) return currentId;
  return options[0]?.id ?? "";
}

async function loadPortalProbe(accessToken: string, session: RolePreviewSession): Promise<PortalProbe> {
  const init = { headers: { "x-role-preview-token": session.previewToken } };
  if (session.targetRole === "TEACHER") {
    await apiRequest<{ id: string }>(accessToken, `${apiBaseUrl}/me/teacher`, init);
    return { label: "Öğretmen portal verisi", value: "Kapsam doğrulandı" };
  }
  if (session.targetRole === "STUDENT") {
    await apiRequest<{ id: string }>(accessToken, `${apiBaseUrl}/me/student/profile`, init);
    return { label: "Öğrenci portal verisi", value: "Kendi profil kapsamı doğrulandı" };
  }

  const students = await apiRequest<Array<{ id: string }>>(accessToken, `${apiBaseUrl}/me/guardian/students`, init);
  return { label: "Veli portal verisi", value: `${students.length} bağlı öğrenci` };
}

function subjectPrivacyLabel(role: RolePreviewSession["targetRole"]): string {
  const labels: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "Veli kaydı doğrulandı",
    STUDENT: "Öğrenci kaydı doğrulandı",
    TEACHER: "Öğretmen kaydı doğrulandı",
  };
  return labels[role];
}

function buildRolePreviewSections(role: PreviewRole) {
  if (role === "TEACHER") {
    return [{ title: "Portal", items: ["Öğretmen Portalı", "/ogretmen", "Kurum sol menüsü görünmez"] }];
  }
  if (role === "STUDENT") {
    return [{ title: "Portal", items: ["Öğrenci Portalı", "/ogrenci", "Kurum sol menüsü görünmez"] }];
  }
  if (role === "GUARDIAN") {
    return [{ title: "Portal", items: ["Veli Portalı", "/veli", "Kurum sol menüsü görünmez"] }];
  }

  return hasInstitutionAccess([role])
    ? getInstitutionNavGroups([role]).map((group) => ({
        title: group.label,
        items: group.items.map((item) => item.label),
      }))
    : [];
}

function buildRolePreviewScopeRows(sections: Array<{ title: string; items: string[] }>): RolePreviewScopeRow[] {
  return sections.flatMap((section) =>
    section.items.map((item, index) => ({
      group: section.title,
      id: `${section.title}:${index}:${item}`,
      item,
    })),
  );
}

function buildRolePreviewMetaRows(role: (typeof roleCards)[number]): RolePreviewMetaRow[] {
  return [
    { id: "subject", label: "Subject", value: role.subjectScope },
    { id: "data", label: "Veri", value: role.dataScope },
    { id: "action", label: "Aksiyon", value: role.writePolicy },
  ];
}

function buildPortalPreviewHref(session: RolePreviewSession): string {
  const routeByRole: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "/veli",
    STUDENT: "/ogrenci",
    TEACHER: "/ogretmen",
  };
  return `${routeByRole[session.targetRole]}?rolePreview=1`;
}

function portalPreviewLabel(role: RolePreviewSession["targetRole"]): string {
  const labels: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "Veli portalını önizle",
    STUDENT: "Öğrenci portalını önizle",
    TEACHER: "Öğretmen portalını önizle",
  };
  return labels[role];
}

function RolePreviewList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  const rows = items.map((item, index) => ({ id: `${title}:${index}`, value: item }));
  return (
    <Panel aria-label={ariaLabel} className="next-role-preview-list-panel" title={title}>
      <DataTable
        caption={title}
        columns={rolePreviewListColumns}
        density="compact"
        getRowKey={(row) => row.id}
        rows={rows}
      />
    </Panel>
  );
}

function formatRolePreviewScopeValue(value: string) {
  return value.startsWith("/") ? <code className="next-role-preview-route">{value}</code> : value;
}
