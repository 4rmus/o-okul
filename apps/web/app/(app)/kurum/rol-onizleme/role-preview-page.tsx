"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@uzman-hocam/ui";
import {
  tenantAssignableRoles,
  tenantRoleLabel,
  type PortalSubjectRoleName,
  type TenantAssignableRoleName,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { getInstitutionNavGroups, hasInstitutionAccess } from "../../_shared/access.js";
import { OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

type PreviewRole = TenantAssignableRoleName;

const roleCards = [
  {
    title: "Öğretmen Portalı",
    route: "/ogretmen",
    account: "TEACHER + subjectType TEACHER",
    scope: "Ders programı, kapsamındaki öğrenciler, yoklama, not, ödev kontrolü ve raporlar",
    demo: "teacher-a@example.test",
    targetRole: "TEACHER",
    targetSubjectId: "teacher-a",
  },
  {
    title: "Öğrenci Portalı",
    route: "/ogrenci",
    account: "STUDENT + subjectType STUDENT",
    scope: "Profil, devamsızlık, duyuru, ödev, destek talebi, sınav raporu ve hata kitapçığı",
    demo: "student-a@example.test",
    targetRole: "STUDENT",
    targetSubjectId: "student-a",
  },
  {
    title: "Veli Portalı",
    route: "/veli",
    account: "GUARDIAN + subjectType GUARDIAN",
    scope: "Bağlı öğrenci, ödeme görünümü, bildirim tercihleri, duyuru, destek ve raporlar",
    demo: "guardian-a@example.test",
    targetRole: "GUARDIAN",
    targetSubjectId: "guardian-a",
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

export function RolePreviewPage() {
  const { auth } = useAuth();
  const [error, setError] = useState("");
  const [session, setSession] = useState<RolePreviewSession | null>(null);
  const [profile, setProfile] = useState<PreviewProfile | null>(null);
  const [portalProbe, setPortalProbe] = useState<PortalProbe | null>(null);
  const [previewRole, setPreviewRole] = useState<PreviewRole>("TENANT_ADMIN");
  const previewSections = buildRolePreviewSections(previewRole);

  async function previewAs(targetRole: RolePreviewSession["targetRole"], targetSubjectId: string) {
    setError("");
    setProfile(null);
    setPortalProbe(null);
    try {
      if (!auth) return;
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
    }
  }

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Rol Önizleme"
      subtitle="Kurum admin için öğretmen, öğrenci ve veli portal kapsamlarını güvenli şekilde izle."
    >
      <MetricPanelGrid
        ariaLabel="Rol önizleme özeti"
        metrics={[
          { label: "Portal", value: "3 rol" },
          { label: "Erişim", value: "Kişi hesabı" },
          { label: "Kapsam", value: "/me bağlı" },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel audit'li ve süreli rol önizleme kaydı başlatır."
        reason="Gerçek kullanıcı kapsamına geçiş salt-okunur ve denetlenebilir önizleme kaydı olmadan açılmaz."
        nextStep="Preview tokenı /me portal sorgularında salt-okuma context olarak kullanılır."
      />
      {error ? <p className="next-form-error">{error}</p> : null}
      {session ? (
        <section className="next-report-list" aria-label="Aktif rol önizleme kaydı">
          <h2>Aktif Önizleme</h2>
          <p>Hedef rol: {session.targetRole}</p>
          <p>Kişi kaydı: {session.targetSubjectId}</p>
          <p>Mod: {session.mode}</p>
          <p>Bitiş: {new Date(session.expiresAt).toLocaleString("tr-TR")}</p>
          {profile ? (
            <>
              <p>Portal context doğrulandı</p>
              <p>Context rol: {profile.roles.join(", ")}</p>
              <p>Context kişi tipi: {profile.subjectType}</p>
              <p>Context kişi kaydı: {profile.subjectId}</p>
            </>
          ) : null}
          {portalProbe ? (
            <p>
              {portalProbe.label}: {portalProbe.value}
            </p>
          ) : null}
          <Link className="uh-button uh-button--primary uh-button--md" href={buildPortalPreviewHref(session)}>
            {portalPreviewLabel(session.targetRole)}
          </Link>
        </section>
      ) : null}
      <section className="next-report-list next-role-preview-list" aria-label="Rol görünüm önizleme">
        <h2>Görünüm Önizleme</h2>
        <label>
          Rol
          <select value={previewRole} onChange={(event) => setPreviewRole(event.target.value as PreviewRole)}>
            {previewRoles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        {previewSections.map((section) => (
          <article key={section.title}>
            <h3>{section.title}</h3>
            {section.items.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </article>
        ))}
      </section>
      <section className="next-report-list next-role-preview-list" aria-label="Rol portal kartları">
        <h2>Portal Kapsamları</h2>
        {roleCards.map((role) => (
          <article key={role.title}>
            <h3>{role.title}</h3>
            <p>{role.account}</p>
            <p>{role.scope}</p>
            <code>{role.route}</code>
            <p>{role.demo}</p>
            <Button type="button" variant="secondary" onClick={() => void previewAs(role.targetRole, role.targetSubjectId)}>
              Auditli {role.title.replace(" Portalı", "").toLocaleLowerCase("tr-TR")} önizleme başlat
            </Button>
          </article>
        ))}
      </section>
      <RolePreviewList title="Erişim Kuralları" ariaLabel="Rol erişim kuralları" items={accessRules} />
      <RolePreviewList title="Kanıt Komutları" ariaLabel="Rol önizleme kanıt komutları" items={evidenceChecks} />
    </PageFrame>
  );
}

async function loadPortalProbe(accessToken: string, session: RolePreviewSession): Promise<PortalProbe> {
  const init = { headers: { "x-role-preview-token": session.previewToken } };
  if (session.targetRole === "TEACHER") {
    const teacher = await apiRequest<{ id: string }>(accessToken, `${apiBaseUrl}/me/teacher`, init);
    return { label: "Öğretmen portal verisi", value: teacher.id };
  }
  if (session.targetRole === "STUDENT") {
    const student = await apiRequest<{ id: string }>(accessToken, `${apiBaseUrl}/me/student/profile`, init);
    return { label: "Öğrenci portal verisi", value: student.id };
  }

  const students = await apiRequest<Array<{ id: string }>>(accessToken, `${apiBaseUrl}/me/guardian/students`, init);
  return { label: "Veli portal verisi", value: `${students.length} bağlı öğrenci` };
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

function buildPortalPreviewHref(session: RolePreviewSession): string {
  const routeByRole: Record<RolePreviewSession["targetRole"], string> = {
    GUARDIAN: "/veli",
    STUDENT: "/ogrenci",
    TEACHER: "/ogretmen",
  };
  return `${routeByRole[session.targetRole]}?rolePreviewToken=${encodeURIComponent(session.previewToken)}`;
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
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
