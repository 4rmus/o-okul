"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Field, MetricCard, MetricGrid, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import {
  isTenantRoleName,
  tenantAssignableRoles,
  tenantRoleLabel,
  type GuardianRecord,
  type PortalSubjectRoleName,
  type StudentRecord,
  type TenantAssignableRoleName,
  type TeacherRecord,
} from "@o-okul/shared-types";
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
    title: "Öğretmen ekranı",
    route: "/ogretmen",
    account: "Öğretmen hesabı",
    scope: "Ders programı, atandığı öğrenciler, yoklama, not, ödev kontrolü ve raporlar",
    subjectScope: "Öğretmen kişi kaydı",
    dataScope: "Yalnızca öğretmene atanmış öğrenci ve ders bilgileri",
    writePolicy: "Değişiklik yapılamaz",
    targetRole: "TEACHER",
  },
  {
    title: "Öğrenci ekranı",
    route: "/ogrenci",
    account: "Öğrenci hesabı",
    scope: "Profil, devamsızlık, duyuru, ödev, destek talebi, sınav raporu ve hata kitapçığı",
    subjectScope: "Öğrenci kişi kaydı",
    dataScope: "Yalnızca öğrencinin kendi bilgileri",
    writePolicy: "Destek ve profil bilgileri değiştirilemez",
    targetRole: "STUDENT",
  },
  {
    title: "Mevcut veli ekranı",
    route: "/veli",
    account: "Mevcut veli hesabı",
    scope: "Bağlı öğrenci, ödeme görünümü, bildirim tercihleri, duyuru, destek ve raporlar",
    subjectScope: "Veli kişi kaydı",
    dataScope: "Yalnızca veliye bağlı öğrencilerin bilgileri",
    writePolicy: "Ödeme ve diğer bilgiler değiştirilemez",
    targetRole: "GUARDIAN",
  },
] as const;

const accessRules = [
  "Kurum yöneticileri kişisel ekranları normal menüde görmez.",
  "Kişisel ekranı açmak için ilgili öğretmen, öğrenci veya mevcut veli hesabı gerekir.",
  "Mevcut veli erişimi yalnız bağlı öğrencinin bilgilerini gösterir.",
  "Öğretmen yalnız sorumlu olduğu öğrencileri ve ders programını görür.",
  "Öğrenci yalnız kendi bilgilerini görür.",
] as const;

const evidenceChecks = [
  "pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g \"Next rol portalları bağlı kişi verisini gösterir\"",
  "pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts",
  "pnpm identity-link:audit",
] as const;

const previewRoles = tenantAssignableRoles.map((role) => ({ label: tenantRoleLabel(role), value: role }));

const rolePreviewMetrics = [
  { description: "Öğretmen, öğrenci ve mevcut veli erişimi", key: "portal", label: "Kişisel ekranlar", tone: "info", value: "Kişiye göre" },
  { description: "İlgili öğretmen, öğrenci veya mevcut veli kaydı seçilir", key: "access", label: "Erişim", tone: "success", value: "Kişiye bağlı" },
  { description: "Her kullanıcı yalnız yetkili olduğu bilgileri görür", key: "scope", label: "Görülebilenler", tone: "default", value: "Sınırlı" },
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
    header: "Menü grubu",
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
    header: "Görülebilenler",
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
      description: "Öğretmen, öğrenci ve mevcut veli erişimi",
      key: "portal-scope",
      label: "Kişisel ekranlar",
      tone: "info",
      value: "Kişiye göre",
    },
    {
      description: "Önizleme sırasında hiçbir kayıt değiştirilemez",
      key: "mode",
      label: "Erişim",
      tone: "success",
      value: "Yalnızca görüntüleme",
    },
    {
      description: "Güvenli erişim bilgisi ekranda ve bağlantıda gösterilmez",
      key: "token",
      label: "Güvenlik",
      tone: "success",
      value: "Gizli",
    },
    {
      description: "Her önizleme sınırlı süreyle açılır ve işlem kaydı tutulur",
      key: "audit",
      label: "İşlem kaydı",
      tone: "info",
      value: "Süreli kayıt",
    },
  ];
  const rolePreviewSummaryBadges: OperationSummaryBadge[] = [
    { key: "readonly", label: "Değişiklik yapılamaz", tone: "success" },
    { key: "scope", label: "Kişiye bağlı bilgiler", tone: "info" },
    { key: "pii", label: "Kişisel veriler gizli", tone: "neutral" },
  ];
  const rolePreviewSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Önizleme yalnız seçtiğiniz kişi için başlatılır",
      key: "preview-start",
      label: "Önizlemeyi başlat",
      status: "Kayıt tutulur",
      tone: "info",
      value: "Seçili kişi",
    },
    {
      detail: "Güvenli erişim bilgisi ekranda veya bağlantıda gösterilmez",
      key: "token-safe",
      label: "Güvenli geçiş",
      status: "Bağlantıda gösterilmez",
      tone: "success",
      value: "Gizli",
    },
    {
      detail: "Seçilen kişinin görebileceği bilgiler açılmadan önce doğrulanır",
      key: "portal-probe",
      label: "Erişim kontrolü",
      status: "Yalnızca görüntüleme",
      tone: "success",
      value: "Doğrulandı",
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
      subtitle="Öğretmen, öğrenci ve mevcut veli erişimini seçtiğiniz kişi adına güvenli biçimde görüntüleyin."
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
        ariaLabel="Önizleme güvenlik özeti"
        badges={rolePreviewSummaryBadges}
        items={rolePreviewSummaryItems}
      />
      <OperationDecisionNotice
        decision="Rol önizlemesi yalnızca görüntüleme için açılır."
        reason="Yönetici seçtiği öğretmen, öğrenci veya mevcut veli erişimini sınırlı süreyle görür; hiçbir kaydı değiştiremez."
        nextStep="Kişiyi seçin, önizlemeyi başlatın ve ilgili ekrana geçin."
      />
      {error ? <p className="next-form-error">{error}</p> : null}
      {previewSubjectsQuery.isError ? <p className="next-form-error">Önizleme kişileri yüklenemedi.</p> : null}
      {session ? (
        <Panel
          aria-label="Aktif rol önizleme kaydı"
          className="next-role-preview-active"
          description="Güvenli erişim bilgisi ekranda veya bağlantıda gösterilmez. Önizleme sınırlı süreyle ve yalnızca görüntüleme için açılır."
          title="Aktif Önizleme"
        >
          <div className="next-role-preview-badges" aria-label="Aktif önizleme güven durumu">
            <StatusBadge tone="success">Yalnızca görüntüleme</StatusBadge>
            <StatusBadge tone={profile ? "success" : "warning"}>
              {profile ? "Kişi erişimi doğrulandı" : "Kişi erişimi bekleniyor"}
            </StatusBadge>
            <StatusBadge tone="info">Süreli</StatusBadge>
          </div>
          <div className="next-role-preview-session-grid">
            <p>Seçili rol: {tenantRoleLabel(session.targetRole)}</p>
            <p>Kişi kaydı: {subjectPrivacyLabel(session.targetRole)}</p>
            <p>Erişim: Yalnızca görüntüleme</p>
            <p>Bitiş: {new Date(session.expiresAt).toLocaleString("tr-TR")}</p>
            {profile ? (
              <>
                <p>Kişi erişimi doğrulandı</p>
                <p>Kullanıcı görevi: {profile.roles.map((role) => isTenantRoleName(role) ? tenantRoleLabel(role) : "Tanımlı görev").join(", ")}</p>
                <p>Kişi türü: {profile.subjectType ? tenantRoleLabel(profile.subjectType) : "Bekleniyor"}</p>
                <p>Kişi kaydı: {profile.subjectId ? "Kimliği gizlenmiş kayıt" : "Bekleniyor"}</p>
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
        description="Seçtiğiniz kullanıcı görevinin görebileceği menü ve kişisel ekranlar."
        title="Görünüm Önizleme"
      >
        <Field label="Rol" description="Seçilen kullanıcı görevinin görebileceği menü ve ekranları gösterir.">
          <Select value={previewRole} onChange={(event) => setPreviewRole(event.target.value as PreviewRole)}>
            {previewRoles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
        </Field>
        <DataTable
          caption="Rolün görebileceği alanlar"
          columns={rolePreviewScopeColumns}
          density="compact"
          description="Kurum yönetimi görevleri menüleri; öğretmen, öğrenci ve mevcut veli erişimi kişisel ekranları gösterir."
          emptyText="Bu rol için görülebilecek alan yok"
          getRowKey={(row) => row.id}
          rows={previewScopeRows}
        />
      </Panel>
      <section className="next-role-preview-portal-grid" aria-label="Kişisel ekran kartları" aria-busy={Boolean(pendingRole)}>
        <header className="next-role-preview-section-header">
          <h2>Kişisel Ekran Önizlemeleri</h2>
          <p>Önizlemeler sınırlı süreyle açılır, işlem kaydı tutulur ve hiçbir bilgi değiştirilemez.</p>
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
                    <StatusBadge tone="success">Yalnızca görüntüleme</StatusBadge>
                    <StatusBadge tone="info">İşlem kaydı tutulur</StatusBadge>
                    <StatusBadge tone="neutral">Seçili kişi</StatusBadge>
                  </div>
                }
                aria-label={`${role.title} önizleme kartı`}
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
                    caption={`${role.title} görülebilen bilgiler`}
                    columns={rolePreviewMetaColumns}
                    density="compact"
                    getRowKey={(row) => row.id}
                    rows={buildRolePreviewMetaRows(role)}
                  />
                  <p>Kişisel giriş bilgileri önizlemede gösterilmez.</p>
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
                      : `${role.title} önizle`}
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
    GUARDIAN: "Kimliği gizlenmiş veli kaydı",
    STUDENT: "Kimliği gizlenmiş öğrenci kaydı",
    TEACHER: "Kimliği gizlenmiş öğretmen kaydı",
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
    return { label: "Öğretmen ekranı", value: "Erişim doğrulandı" };
  }
  if (session.targetRole === "STUDENT") {
    await apiRequest<{ id: string }>(accessToken, `${apiBaseUrl}/me/student/profile`, init);
    return { label: "Öğrenci ekranı", value: "Kendi bilgilerine erişim doğrulandı" };
  }

  const students = await apiRequest<Array<{ id: string }>>(accessToken, `${apiBaseUrl}/me/guardian/students`, init);
  return { label: "Mevcut veli ekranı", value: `${students.length} bağlı öğrenci` };
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
    return [{ title: "Kişisel ekran", items: ["Öğretmen ekranı", "/ogretmen", "Kurum sol menüsü görünmez"] }];
  }
  if (role === "STUDENT") {
    return [{ title: "Kişisel ekran", items: ["Öğrenci ekranı", "/ogrenci", "Kurum sol menüsü görünmez"] }];
  }
  if (role === "GUARDIAN") {
    return [{ title: "Mevcut erişim", items: ["Mevcut veli ekranı", "/veli", "Kurum sol menüsü görünmez"] }];
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
    { id: "subject", label: "Kişi", value: role.subjectScope },
    { id: "data", label: "Görülebilen bilgiler", value: role.dataScope },
    { id: "action", label: "İşlem", value: role.writePolicy },
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
    GUARDIAN: "Mevcut veli ekranına geç",
    STUDENT: "Öğrenci ekranına geç",
    TEACHER: "Öğretmen ekranına geç",
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
