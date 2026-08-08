"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  DataTable,
  Field,
  InfoGrid,
  InfoItem,
  Panel,
  Select,
  StatusBadge,
  TabButton,
  Tabs,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@o-okul/ui";
import type {
  GuardianRecord,
  GuardianStudentDetailStudentRecord,
  GuardianStudentDetailsResponse,
  GuardianStudentRecord,
} from "@o-okul/shared-types";
import { ArrowLeft, Link2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";
import { PageFrame } from "../_shared/page-frame.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { RevealablePhone } from "../_shared/revealable-phone.js";

interface GuardianDetailData {
  availableStudents: GuardianStudentDetailStudentRecord[];
  guardian: GuardianRecord;
  links: GuardianStudentRecord[];
  studentById: Map<string, GuardianStudentDetailStudentRecord>;
}

const emptyLinkForm = {
  canOpenSupportTickets: false,
  canReceiveAnnouncements: false,
  canReceiveSms: false,
  canViewFinance: false,
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
  const [activeSection, setActiveSection] = useState<"links" | "new-link">("links");
  const detail = detailQuery.data;
  const guardianName = detail ? `${detail.guardian.firstName} ${detail.guardian.lastName}` : "Veli detayı";
  const availableStudents = detail?.availableStudents ?? [];
  const canRevealPhone = hasCapabilityForRoles(auth?.session.roles ?? [], "privacy:manage");
  const guardianSummaryItems = detail ? buildGuardianSummaryItems(detail, { canRevealPhone }) : [];
  const guardianSummaryBadges = detail ? buildGuardianSummaryBadges(detail) : [];
  const guardianSummaryActions = detail ? buildGuardianSummaryActions(detail) : [];
  const guardianStudentColumns = detail ? buildGuardianStudentColumns(detail) : [];

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
      <section className="next-detail-workspace" aria-label="Veli detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Veli detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <OperationSummary
              actions={guardianSummaryActions}
              ariaLabel="Veli detay özeti"
              badges={guardianSummaryBadges}
              items={guardianSummaryItems}
            />
            <Panel
              aria-label="Veli profili"
              description="Telefon varsayılan maskeli gösterilir; yetkili kullanıcı aynı satırda açıp tekrar gizleyebilir."
              title="Veli profili"
            >
              <InfoGrid className="next-guardian-profile-info" aria-label="Veli profil özeti" role="region">
                <InfoItem label="Telefon" value={<RevealablePhone canReveal={canRevealPhone} value={detail.guardian.phone} />} />
                <InfoItem label="Portal" value={detail.guardian.userId ? "Bağlı" : "Yok"} />
                <InfoItem label="Öğrenci bağlantısı" value={`${formatCount(detail.links.length)} bağlantı`} />
                <InfoItem label="Finans görünürlüğü" value={formatPermissionCount(detail.links, "canViewFinance")} />
                {isSmsEnabled ? <InfoItem label="SMS izni" value={formatPermissionCount(detail.links, "canReceiveSms")} /> : null}
                <InfoItem label="Destek izni" value={formatPermissionCount(detail.links, "canOpenSupportTickets")} />
              </InfoGrid>
            </Panel>
            <Tabs label="Veli detay bölümleri">
              <TabButton aria-controls="guardian-detail-panel-links" id="guardian-detail-tab-links" selected={activeSection === "links"} onClick={() => setActiveSection("links")}>Öğrenci bağlantıları</TabButton>
              <TabButton aria-controls="guardian-detail-panel-new-link" id="guardian-detail-tab-new-link" selected={activeSection === "new-link"} onClick={() => setActiveSection("new-link")}>Öğrenci bağla</TabButton>
            </Tabs>
            {activeSection === "links" ? <div aria-labelledby="guardian-detail-tab-links" id="guardian-detail-panel-links" role="tabpanel" tabIndex={0}>
              <Panel
                aria-label="Öğrenci bağlantıları"
                description="İzinler öğrenci bazında açık/kapalı gösterilir; ödeme tutarı ve ham iletişim bilgisi bu özetlerde yer almaz."
                title="Öğrenci bağlantıları"
              >
                <DataTable
                  caption="Veli öğrenci bağlantıları"
                  columns={guardianStudentColumns}
                  density="compact"
                  description="Öğrenci, sınıf, portal ve izin kapsamı. Ödeme tutarı ve ham iletişim bilgisi gösterilmez."
                  emptyText="Öğrenci bağlantısı yok"
                  getRowKey={(link) => link.id}
                  rows={detail.links}
                />
              </Panel>
            </div> : null}
            {activeSection === "new-link" ? <div aria-labelledby="guardian-detail-tab-new-link" id="guardian-detail-panel-new-link" role="tabpanel" tabIndex={0}>
              <Panel
                aria-label="Veli öğrenci bağı ekle"
                description="Hassas izinler varsayılan kapalıdır; yalnız açıkça seçilen yetkiler veli portalına açılır."
                title="Öğrenci bağla"
              >
              <form className="next-guardian-link-form" onSubmit={(event) => void handleLinkSubmit(event)}>
                <div className="next-guardian-link-form__grid">
                  <Field label="Öğrenci">
                    <Select
                      aria-label="Öğrenci"
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
                    </Select>
                  </Field>
                </div>
                <fieldset className="next-permission-fieldset">
                  <legend>Erişim izinleri</legend>
                  <span className="next-field-hint">Hassas izinler varsayılan kapalıdır; yalnız açıkça seçilen yetkiler gönderilir.</span>
                  {guardianPermissionOptions.map((permission) => (
                    <Checkbox
                      checked={linkForm[permission.key]}
                      className="next-permission-toggle"
                      description={permission.description}
                      key={permission.key}
                      label={permission.label}
                      onChange={(event) =>
                        setLinkForm((current) => ({
                          ...current,
                          [permission.key]: event.target.checked,
                        }))
                      }
                    />
                  ))}
                </fieldset>
                {linkError ? <p className="uh-crud-page__error">{linkError}</p> : null}
                <Button disabled={availableStudents.length === 0} type="submit">
                  <Link2 size={17} aria-hidden="true" />
                  Bağla
                </Button>
              </form>
              </Panel>
            </div> : null}
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadGuardianDetail(accessToken: string, guardianId: string) {
  const [guardian, studentDetails] = await Promise.all([
    apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}`),
    apiRequest<GuardianStudentDetailsResponse>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/student-details`),
  ]);
  const studentReferences = [...studentDetails.linkedStudents, ...studentDetails.availableStudents];

  return {
    availableStudents: studentDetails.availableStudents,
    guardian,
    links: studentDetails.links,
    studentById: new Map(studentReferences.map((record) => [record.id, record])),
  };
}

async function linkGuardianStudent(
  accessToken: string,
  guardianId: string,
  input: typeof emptyLinkForm,
) {
  return apiRequest<GuardianStudentRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/students`, {
    body: JSON.stringify({
      canOpenSupportTickets: input.canOpenSupportTickets,
      canReceiveAnnouncements: input.canReceiveAnnouncements,
      canReceiveSms: input.canReceiveSms,
      canViewFinance: input.canViewFinance,
      studentId: input.studentId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function buildGuardianSummaryItems(detail: GuardianDetailData, options: { canRevealPhone: boolean }): OperationSummaryItem[] {
  const activeStudentCount = activeGuardianStudentCount(detail.links, detail.studentById);
  return [
    {
      description: "Ham iletişim bilgisi maskelenir",
      key: "phone",
      label: "Telefon",
      tone: "info",
      value: <RevealablePhone canReveal={options.canRevealPhone} value={detail.guardian.phone} />,
    },
    {
      description: `${formatCount(activeStudentCount)} aktif öğrenci`,
      key: "links",
      label: "Öğrenci bağlantısı",
      tone: detail.links.length > 0 ? "success" : "warning",
      value: formatCount(detail.links.length),
    },
    {
      description: "Yalnız portal izin durumu; ödeme tutarı gösterilmez",
      key: "finance",
      label: "Finans görünürlüğü",
      tone: permissionEnabledCount(detail.links, "canViewFinance") > 0 ? "info" : "default",
      value: formatPermissionCount(detail.links, "canViewFinance"),
    },
    {
      description: "Veli portal hesabı",
      key: "portal",
      label: "Portal",
      tone: detail.guardian.userId ? "success" : "warning",
      value: detail.guardian.userId ? "Bağlı" : "Yok",
    },
  ];
}

function buildGuardianSummaryBadges(detail: GuardianDetailData): OperationSummaryBadge[] {
  return [
    {
      key: "pii",
      label: "Kişisel bilgiler maskeli",
      tone: "success",
    },
    {
      key: "portal",
      label: detail.guardian.userId ? "Portal bağlı" : "TC + telefon bekliyor",
      tone: detail.guardian.userId ? "success" : "warning",
    },
    {
      key: "relationships",
      label: detail.links.length > 0 ? "İlişki aktif" : "İlişki bekliyor",
      tone: detail.links.length > 0 ? "info" : "neutral",
    },
  ];
}

function buildGuardianSummaryActions(detail: GuardianDetailData): OperationSummaryAction[] {
  const enabledPermissionCount = guardianEnabledPermissionCount(detail.links);
  const totalPermissionCount = detail.links.length * guardianPermissionOptions.length;
  return [
    {
      detail: "Veli öğrenci bağlantıları",
      key: "relationship-control",
      label: "Bağlantı kontrolü",
      status: detail.links.length > 0 ? "Bağlı" : "Bağ yok",
      tone: detail.links.length > 0 ? "success" : "warning",
      value: `${formatCount(detail.links.length)} bağ`,
    },
    {
      detail: isSmsEnabled ? "Finans, SMS, duyuru ve destek izinleri" : "Finans, duyuru ve destek izinleri",
      key: "permission-scope",
      label: "İzin kapsamı",
      status: enabledPermissionCount > 0 ? "Kontrollü" : "Kapalı",
      tone: enabledPermissionCount > 0 ? "info" : "neutral",
      value: `${enabledPermissionCount}/${totalPermissionCount} açık`,
    },
    {
      detail: "Veli portal erişimi",
      key: "portal-link",
      label: "Portal bağlantısı",
      status: detail.guardian.userId ? "Bağlı" : "TC + telefon",
      tone: detail.guardian.userId ? "success" : "warning",
      value: detail.guardian.userId ? "Hesap bağlı" : "Bilgi bekliyor",
    },
  ];
}

function buildGuardianStudentColumns(detail: GuardianDetailData): Array<DataTableColumn<GuardianStudentRecord>> {
  return [
    {
      key: "student",
      header: "Öğrenci",
      mobilePriority: "primary",
      priority: "primary",
      render: (link) => {
        const student = detail.studentById.get(link.studentId);
        return (
          <span className="next-report-student-name">
            {formatGuardianStudentName(student)}
            <small>{student?.studentNo ? `Öğrenci no ${student.studentNo}` : "Öğrenci no yok"}</small>
          </span>
        );
      },
      sticky: "left",
    },
    {
      key: "class",
      header: "Sınıf",
      mobilePriority: "hidden",
      priority: "optional",
      render: (link) => formatGuardianStudentClass(detail.studentById.get(link.studentId)),
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (link) => {
        const student = detail.studentById.get(link.studentId);
        return student ? <StatusBadge tone={studentStatusTone(student.status)}>{formatStudentStatus(student.status)}</StatusBadge> : "Öğrenci eşleşmedi";
      },
    },
    {
      key: "portal",
      header: "Portal",
      mobilePriority: "hidden",
      priority: "optional",
      render: (link) => {
        const student = detail.studentById.get(link.studentId);
        return <StatusBadge tone={student?.hasPortalUser ? "success" : "neutral"}>{student?.hasPortalUser ? "Bağlı" : "Yok"}</StatusBadge>;
      },
    },
    {
      key: "permissions",
      header: "İzinler",
      mobilePriority: "primary",
      priority: "primary",
      render: (link) => (
        <span className="next-permission-row" aria-label={`${formatGuardianStudentName(detail.studentById.get(link.studentId))} izinleri`}>
          {permissionBadges(link).map((permission) => (
            <StatusBadge key={permission.label} tone={permission.enabled ? "success" : "neutral"}>
              {permission.label}
            </StatusBadge>
          ))}
        </span>
      ),
    },
  ];
}

function formatStudentStatus(status: GuardianStudentDetailStudentRecord["status"]) {
  const labels: Record<GuardianStudentDetailStudentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? status;
}

function studentStatusTone(status: GuardianStudentDetailStudentRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "PASSIVE") return "warning";
  return "neutral";
}

function formatGuardianStudentName(student: GuardianStudentDetailStudentRecord | undefined) {
  return student ? `${student.firstName} ${student.lastName}` : "Öğrenci kaydı eşleşmedi";
}

function formatGuardianStudentClass(student: GuardianStudentDetailStudentRecord | undefined) {
  return student?.className?.trim() || "Sınıf eşleşmedi";
}

function activeGuardianStudentCount(
  links: GuardianStudentRecord[],
  studentById: ReadonlyMap<string, GuardianStudentDetailStudentRecord>,
) {
  return links.filter((link) => studentById.get(link.studentId)?.status === "ACTIVE").length;
}

function permissionEnabledCount(links: GuardianStudentRecord[], key: keyof Pick<
  GuardianStudentRecord,
  "canOpenSupportTickets" | "canReceiveSms" | "canViewFinance"
>) {
  return links.filter((link) => link[key]).length;
}

function formatPermissionCount(links: GuardianStudentRecord[], key: keyof Pick<
  GuardianStudentRecord,
  "canOpenSupportTickets" | "canReceiveSms" | "canViewFinance"
>) {
  const enabledCount = permissionEnabledCount(links, key);
  return `${enabledCount}/${links.length} açık`;
}

function guardianEnabledPermissionCount(links: GuardianStudentRecord[]) {
  return links.reduce((total, link) => total + permissionBadges(link).filter((permission) => permission.enabled).length, 0);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function permissionBadges(link: GuardianStudentRecord): Array<{ enabled: boolean; label: string }> {
  const badges: Array<{ enabled: boolean; label: string }> = [
    { enabled: link.canViewFinance, label: `Finans ${link.canViewFinance ? "açık" : "kapalı"}` },
    { enabled: link.canReceiveAnnouncements, label: `Duyuru ${link.canReceiveAnnouncements ? "açık" : "kapalı"}` },
    { enabled: link.canOpenSupportTickets, label: `Destek ${link.canOpenSupportTickets ? "açık" : "kapalı"}` },
  ];
  if (isSmsEnabled) badges.splice(1, 0, { enabled: link.canReceiveSms, label: `SMS ${link.canReceiveSms ? "açık" : "kapalı"}` });
  return badges;
}

const guardianPermissionOptions: Array<{
  description: string;
  key: "canOpenSupportTickets" | "canReceiveAnnouncements" | "canReceiveSms" | "canViewFinance";
  label: string;
}> = [
  {
    description: "Ödeme ve tahsilat bilgisini veli portalında gösterir.",
    key: "canViewFinance",
    label: "Finans görünürlüğü",
  },
  ...(isSmsEnabled ? [{
    description: "Duyuru ve bilgilendirme SMS alıcısı olarak kullanılır.",
    key: "canReceiveSms" as const,
    label: "SMS alabilir",
  }] : []),
  {
    description: "Kurum duyurularını veli portalında gösterir.",
    key: "canReceiveAnnouncements",
    label: "Duyuru görebilir",
  },
  {
    description: "Öğrenci adına destek talebi açmasına izin verir.",
    key: "canOpenSupportTickets",
    label: "Destek talebi açabilir",
  },
];
