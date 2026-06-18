"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
} from "@uzman-hocam/ui";
import {
  isPortalSubjectRoleName,
  portalSubjectRoles,
  tenantAssignableRoles,
  tenantRoleLabel,
  type GuardianRecord,
  type PortalSubjectRoleName,
  type StudentRecord,
  type TeacherRecord,
  type TenantAssignableRoleName,
} from "@uzman-hocam/shared-types";
import { Plus, RotateCcw, Save, Send } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import {
  firstFormError,
  identityInvitationFormSchema,
  tenantUserFormSchema,
  userRolesSchema,
  type IdentityInvitationFormPayload,
  type IdentityInvitationFormState,
  type TenantUserFormPayload,
  type TenantUserFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

type Role = TenantAssignableRoleName;
type InvitationSubjectType = PortalSubjectRoleName;
type InvitationStatus = "PENDING" | "ACCEPTED";

interface TenantUserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

interface IdentityInvitationRecord {
  id: string;
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email: string;
  name: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  acceptedUserId?: string;
  createdAt: string;
  updatedAt: string;
}

interface IdentityInvitationIssueResult {
  invitation: IdentityInvitationRecord;
  activationToken: string;
}

interface UserSubjectReferences {
  guardians: GuardianRecord[];
  students: StudentRecord[];
  teachers: TeacherRecord[];
}

const roleOptions = tenantAssignableRoles.map((role) => ({ value: role, label: tenantRoleLabel(role) }));

const subjectTypeLabels = Object.fromEntries(
  portalSubjectRoles.map((role) => [role, tenantRoleLabel(role)]),
) as Record<InvitationSubjectType, string>;

const statusLabels: Record<InvitationStatus, string> = {
  ACCEPTED: "Kabul edildi",
  PENDING: "Bekliyor",
};

const emptyUserForm: TenantUserFormState = {
  email: "",
  name: "",
  password: "",
  roles: ["TEACHER"],
};

const emptyInvitationForm: IdentityInvitationFormState = {
  subjectType: "STUDENT",
  subjectId: "",
  email: "",
  name: "",
};

const emptySubjectReferences: UserSubjectReferences = {
  guardians: [],
  students: [],
  teachers: [],
};

export function UsersPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [userListQuery, setUserListQuery] = useUrlListState(searchParams, { namespace: "users", sortOptions: tenantUserSortOptions });
  const [invitationListQuery, setInvitationListQuery] = useUrlListState(searchParams, { namespace: "invitations", sortOptions: identityInvitationSortOptions });
  const usersQueryKey = ["next-tenant-users", tenantId, userListQuery];
  const usersListQueryKey = ["next-tenant-users", tenantId];
  const invitationsQueryKey = ["next-identity-invitations", tenantId, invitationListQuery];
  const invitationsListQueryKey = ["next-identity-invitations", tenantId];
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => loadTenantUsers(auth?.accessToken ?? "", userListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const invitationsQuery = useQuery({
    queryKey: invitationsQueryKey,
    queryFn: () => loadInvitations(auth?.accessToken ?? "", invitationListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const subjectReferencesQuery = useQuery({
    queryKey: ["next-user-subject-refs", tenantId],
    queryFn: () => loadUserSubjectReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role[]>>({});
  const [isUserFormOpen, setIsUserFormOpen] = useState(false);
  const [userForm, setUserForm] = useState<TenantUserFormState>(emptyUserForm);
  const [isInvitationFormOpen, setIsInvitationFormOpen] = useState(false);
  const [invitationForm, setInvitationForm] = useState<IdentityInvitationFormState>(emptyInvitationForm);
  const [issuedToken, setIssuedToken] = useState<{ email: string; token: string } | null>(null);
  const [isIssuedTokenRevealed, setIsIssuedTokenRevealed] = useState(false);
  const [error, setError] = useState("");

  const users = usersQuery.data?.data ?? [];
  const invitations = invitationsQuery.data?.data ?? [];
  const subjectReferences = subjectReferencesQuery.data ?? emptySubjectReferences;
  const subjects = useMemo(
    () => buildSubjects(invitationForm.subjectType, subjectReferences.students, subjectReferences.guardians, subjectReferences.teachers),
    [invitationForm.subjectType, subjectReferences.guardians, subjectReferences.students, subjectReferences.teachers],
  );
  const selectedInvitationSubject = subjects.find((subject) => subject.id === invitationForm.subjectId);

  useEffect(() => {
    const subjectType = parseInvitationSubjectType(searchParams.get("invite"));
    if (!subjectType) return;
    const subjectId = searchParams.get("subjectId");
    if (!subjectId) return;
    setInvitationForm({
      subjectType,
      subjectId,
      email: "",
      name: findSubjectName(subjectType, subjectId, subjectReferences),
    });
    setError("");
    setIssuedToken(null);
    setIsIssuedTokenRevealed(false);
    setIsInvitationFormOpen(true);
  }, [searchParams, subjectReferences]);

  const userColumns: Array<DataTableColumn<TenantUserRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      render: (user) => user.name,
      sticky: "left",
    },
    {
      key: "email",
      header: "E-posta",
      priority: "secondary",
      render: (user) => user.email,
    },
    {
      key: "roles",
      header: "Roller",
      priority: "primary",
      render: (user) => (
        <div
          className={hasRoleDraftChanges(user) ? "next-role-checks next-role-checks--dirty" : "next-role-checks"}
          aria-label={`${user.name} rolleri`}
          aria-describedby={hasRoleDraftChanges(user) ? `role-draft-status-${user.id}` : undefined}
        >
          {roleOptions.map((role) => (
            <label key={role.value}>
              <input
                checked={getDraftRoles(user).includes(role.value)}
                onChange={() => toggleRole(user.id, role.value)}
                type="checkbox"
              />
              {role.label}
            </label>
          ))}
          {hasRoleDraftChanges(user) ? (
            <span className="next-role-draft-status" id={`role-draft-status-${user.id}`}>
              <StatusBadge tone="warning">Kaydedilmemiş rol değişikliği</StatusBadge>
              <button type="button" onClick={() => resetRoleDraft(user.id)} aria-label={`${user.name} rol taslağını sıfırla`}>
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      render: (user) => (
        <span className="next-row-actions">
          <button
            type="button"
            disabled={!hasRoleDraftChanges(user)}
            onClick={() => void saveRoles(user)}
            aria-label={`${user.name} rollerini kaydet`}
          >
            <Save size={17} aria-hidden="true" />
          </button>
        </span>
      ),
      sticky: "right",
    },
  ];

  const invitationColumns: Array<DataTableColumn<IdentityInvitationRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      render: (invitation) => invitation.name,
      sticky: "left",
    },
    {
      key: "email",
      header: "E-posta",
      priority: "secondary",
      render: (invitation) => invitation.email,
    },
    {
      key: "subject",
      header: "Kişi",
      priority: "secondary",
      render: (invitation) => subjectTypeLabels[invitation.subjectType],
    },
    {
      key: "role",
      header: "Rol",
      priority: "secondary",
      render: (invitation) => tenantRoleLabel(invitation.role),
    },
    {
      key: "status",
      header: "Durum",
      priority: "primary",
      render: (invitation) => (
        <StatusBadge tone={invitationStatusTone(invitation.status)}>
          {statusLabels[invitation.status]}
        </StatusBadge>
      ),
    },
    {
      key: "expiresAt",
      header: "Bitiş",
      priority: "optional",
      render: (invitation) => formatDate(invitation.expiresAt),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      render: (invitation) =>
        invitation.status === "PENDING" ? (
          <span className="next-row-actions">
            <button type="button" onClick={() => void resendInvitation(invitation)} aria-label={`${invitation.name} davetini yenile`}>
              <RotateCcw size={17} aria-hidden="true" />
            </button>
          </span>
        ) : (
          "-"
        ),
      sticky: "right",
    },
  ];

  function getDraftRoles(user: TenantUserRecord) {
    return roleDrafts[user.id] ?? user.roles;
  }

  function hasRoleDraftChanges(user: TenantUserRecord) {
    return normalizeRoles(getDraftRoles(user)).join("|") !== normalizeRoles(user.roles).join("|");
  }

  function toggleRole(userId: string, role: Role) {
    setRoleDrafts((current) => {
      const user = users.find((candidate) => candidate.id === userId);
      const roles = current[userId] ?? user?.roles ?? [];
      const nextRoles = roles.includes(role) ? roles.filter((candidate) => candidate !== role) : [...roles, role];
      return { ...current, [userId]: nextRoles };
    });
  }

  function resetRoleDraft(userId: string) {
    setRoleDrafts((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  function openUserForm() {
    setUserForm(emptyUserForm);
    setError("");
    setIsUserFormOpen(true);
  }

  function openInvitationForm() {
    setInvitationForm(emptyInvitationForm);
    setError("");
    setIssuedToken(null);
    setIsIssuedTokenRevealed(false);
    setIsInvitationFormOpen(true);
  }

  async function saveRoles(user: TenantUserRecord) {
    if (!auth) return;

    setError("");
    const parsedRoles = userRolesSchema.safeParse(getDraftRoles(user));
    if (!parsedRoles.success) {
      setError(firstFormError(parsedRoles.error));
      return;
    }
    try {
      const saved = await setTenantUserRoles(auth.accessToken, user.id, parsedRoles.data);
      void saved;
      void queryClient.invalidateQueries({ queryKey: usersListQueryKey });
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
    } catch (rolesError) {
      setError(apiErrorMessage(rolesError, "Roller kaydedilemedi."));
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = tenantUserFormSchema.safeParse(userForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      await createTenantUser(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: usersListQueryKey });
      setIsUserFormOpen(false);
      setUserForm(emptyUserForm);
    } catch (userError) {
      setError(apiErrorMessage(userError, "Kullanıcı oluşturulamadı."));
    }
  }

  async function handleInvitationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = identityInvitationFormSchema.safeParse(invitationForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const issued = await createInvitation(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: invitationsListQueryKey });
      setIssuedToken({ email: issued.invitation.email, token: issued.activationToken });
      setIsIssuedTokenRevealed(false);
      setIsInvitationFormOpen(false);
      setInvitationForm(emptyInvitationForm);
    } catch (invitationError) {
      setError(apiErrorMessage(invitationError, "Davet oluşturulamadı."));
    }
  }

  async function resendInvitation(invitation: IdentityInvitationRecord) {
    if (!auth) return;

    setError("");
    try {
      const issued = await resendIdentityInvitation(auth.accessToken, invitation.id);
      void queryClient.invalidateQueries({ queryKey: invitationsListQueryKey });
      setIssuedToken({ email: issued.invitation.email, token: issued.activationToken });
      setIsIssuedTokenRevealed(false);
    } catch (resendError) {
      setError(apiErrorMessage(resendError, "Davet yenilenemedi."));
    }
  }

  const draftRoleCount = users.filter((user) => hasRoleDraftChanges(user)).length;
  const pendingInvitationCount = invitations.filter((invitation) => invitation.status === "PENDING").length;
  const acceptedInvitationCount = invitations.filter((invitation) => invitation.status === "ACCEPTED").length;
  const subjectReferenceCount =
    subjectReferences.students.length + subjectReferences.guardians.length + subjectReferences.teachers.length;
  const userSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş yönetim hesabı",
      key: "users",
      label: "Kullanıcı toplamı",
      value: formatCount(usersQuery.data?.meta?.total ?? users.length),
    },
    {
      description: "Aktivasyon bekleyen portal daveti",
      key: "pendingInvitations",
      label: "Davet bekliyor",
      tone: pendingInvitationCount > 0 ? "warning" : "success",
      value: formatCount(pendingInvitationCount),
    },
    {
      description: "Hesaba bağlanmış davet",
      key: "acceptedInvitations",
      label: "Kabul edildi",
      tone: acceptedInvitationCount > 0 ? "success" : "default",
      value: formatCount(acceptedInvitationCount),
    },
    {
      description: "Henüz kaydedilmemiş rol satırı",
      key: "roleDrafts",
      label: "Rol taslağı",
      tone: draftRoleCount > 0 ? "warning" : "default",
      value: formatCount(draftRoleCount),
    },
  ];
  const userSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "token",
      label: issuedToken ? (isIssuedTokenRevealed ? "Token açık" : "Token maskeli") : "Token beklemede yok",
      tone: issuedToken ? (isIssuedTokenRevealed ? "warning" : "neutral") : "neutral",
    },
    {
      key: "portal",
      label: `${formatCount(subjectReferenceCount)} portal kişi referansı`,
      tone: subjectReferenceCount > 0 ? "info" : "neutral",
    },
    {
      key: "state",
      label: "URL state ayrışık",
      tone: "neutral",
    },
  ];

  return (
    <div className="next-users-page">
      <CrudPage
        actions={
          <>
            <ListControls
              meta={usersQuery.data?.meta}
              onChange={setUserListQuery}
              sortOptions={tenantUserSortOptions}
              state={userListQuery}
            />
            <div className="next-users-actions">
              <Button onClick={openUserForm} variant="secondary">
                <Plus size={17} aria-hidden="true" />
                Kullanıcı ekle
              </Button>
              <Button onClick={openInvitationForm}>
                <Send size={17} aria-hidden="true" />
                Davet oluştur
              </Button>
            </div>
          </>
        }
        aria-label="Kullanıcı ve rol yönetimi"
        columns={userColumns}
        density="compact"
        description="Yönetim hesaplarını ve tenant rollerini yönet. Öğretmen, öğrenci ve veli portal erişimi için kişi davetlerini kullan."
        emptyState={
          <EmptyState
            title="Kullanıcı yok"
            description="Kurum yönetim paneli için ilk yönetim hesabını oluştur."
            hint="Portal erişimi için kişi davetleri ayrı listeden takip edilir."
            primaryAction={{ label: "Kullanıcı ekle", onClick: openUserForm }}
            secondaryAction={{ label: "Davet oluştur", onClick: openInvitationForm }}
          />
        }
        emptyText="Kullanıcı kaydı yok"
        error={error || (usersQuery.isError ? apiErrorMessage(usersQuery.error, "Kullanıcılar alınamadı.") : undefined)}
        getRowKey={(user) => user.id}
        loading={usersQuery.isPending}
        rows={users}
        tableCaption="Kurum kullanıcıları"
        tableDescription="Panel kullanıcıları ve tenant rolleri. Portal erişimleri davet akışından yönetilir."
        summary={
          <OperationSummary ariaLabel="Kullanıcı ve davet operasyon özeti" badges={userSummaryBadges} items={userSummaryItems} />
        }
        title="Kullanıcılar"
      />
      {issuedToken ? (
        <section
          className="next-token-panel"
          aria-label="Son aktivasyon tokenı"
          aria-live="polite"
          data-token-state={isIssuedTokenRevealed ? "revealed" : "masked"}
        >
          <div className="next-token-panel__body">
            <div className="next-token-panel__status" aria-label="Aktivasyon token güven durumu">
              <StatusBadge tone="warning">Tek seferlik</StatusBadge>
              <StatusBadge tone={isIssuedTokenRevealed ? "warning" : "neutral"}>
                {isIssuedTokenRevealed ? "Token açık" : "Token maskeli"}
              </StatusBadge>
              <StatusBadge tone="neutral">Portal daveti</StatusBadge>
            </div>
            <strong>{issuedToken.email}</strong>
            <p>Aktivasyon tokenı tek seferliktir; yalnız paylaşacağın anda göster ve işin bitince panelden kaldır.</p>
          </div>
          <code className="next-token-panel__token">
            {isIssuedTokenRevealed ? issuedToken.token : maskActivationToken(issuedToken.token)}
          </code>
          <div className="next-token-panel__actions">
            <Button type="button" variant="secondary" onClick={() => setIsIssuedTokenRevealed((current) => !current)}>
              {isIssuedTokenRevealed ? "Tokenı gizle" : "Tokenı göster"}
            </Button>
            <Button
              type="button"
              variant={isIssuedTokenRevealed ? "primary" : "secondary"}
              onClick={() => {
                setIssuedToken(null);
                setIsIssuedTokenRevealed(false);
              }}
            >
              Tokenı kapat
            </Button>
          </div>
        </section>
      ) : null}
      <CrudPage
        actions={
          <ListControls
            meta={invitationsQuery.data?.meta}
            onChange={setInvitationListQuery}
            sortOptions={identityInvitationSortOptions}
            state={invitationListQuery}
          />
        }
        aria-label="Kimlik davetleri"
        columns={invitationColumns}
        density="compact"
        description="Mevcut öğretmen, öğrenci ve veli kayıtlarını giriş hesabına bağlayan portal davetlerini takip et."
        emptyState={
          <EmptyState
            title="Davet yok"
            description="Öğretmen, öğrenci veya veli portalı için ilk daveti oluştur."
            hint="Davet oluşturulduğunda aktivasyon tokenı ekranda gösterilir."
            primaryAction={{ label: "Davet oluştur", onClick: openInvitationForm }}
          />
        }
        emptyText="Davet kaydı yok"
        error={invitationsQuery.isError ? apiErrorMessage(invitationsQuery.error, "Davetler alınamadı.") : undefined}
        getRowKey={(invitation) => invitation.id}
        loading={invitationsQuery.isPending}
        rows={invitations}
        tableCaption="Portal davetleri"
        tableDescription="Öğretmen, öğrenci ve veli kayıtlarına bağlı giriş davetleri ve aktivasyon durumu."
        title="Davetler"
      />
      <FormModal
        description="E-posta, ad soyad, şifre ve en az bir rol zorunludur."
        onCancel={() => setIsUserFormOpen(false)}
        onSubmit={(event) => void handleUserSubmit(event)}
        open={isUserFormOpen}
        submitLabel="Ekle"
        title="Kullanıcı ekle"
      >
        <Field label="E-posta">
          <Input
            required
            type="email"
            value={userForm.email}
            onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>
        <Field label="Ad Soyad">
          <Input
            required
            value={userForm.name}
            onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Şifre">
          <Input
            minLength={8}
            required
            type="password"
            value={userForm.password}
            onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
          />
        </Field>
        <fieldset className="next-role-fieldset">
          <legend>Roller</legend>
          {roleOptions.map((role) => (
            <label key={role.value}>
              <input
                checked={userForm.roles.includes(role.value)}
                onChange={() =>
                  setUserForm((current) => ({
                    ...current,
                    roles: current.roles.includes(role.value)
                      ? current.roles.filter((candidate) => candidate !== role.value)
                      : [...current.roles, role.value],
                  }))
                }
                type="checkbox"
              />
              {role.label}
            </label>
          ))}
        </fieldset>
      </FormModal>
      <FormModal
        description="Davet edilecek kişi, kurum kayıtlarında bulunmalıdır."
        onCancel={() => setIsInvitationFormOpen(false)}
        onSubmit={(event) => void handleInvitationSubmit(event)}
        open={isInvitationFormOpen}
        submitLabel="Oluştur"
        title="Davet oluştur"
      >
        {invitationForm.subjectId ? (
          <div className="next-invitation-context" aria-label="Davet bağlamı">
            <span>Davet hedefi</span>
            <strong>{selectedInvitationSubject?.name || invitationForm.name || "Seçili kayıt"}</strong>
            <div>
              <StatusBadge tone="info">{subjectTypeLabels[invitationForm.subjectType]}</StatusBadge>
              <StatusBadge tone={invitationForm.email ? "success" : "neutral"}>
                {invitationForm.email ? "E-posta hazır" : "E-posta bekliyor"}
              </StatusBadge>
            </div>
          </div>
        ) : null}
        <Field label="Kişi türü">
          <Select
            value={invitationForm.subjectType}
            onChange={(event) =>
              setInvitationForm((current) => ({
                ...current,
                subjectId: "",
                subjectType: event.target.value as InvitationSubjectType,
              }))
            }
          >
            {Object.entries(subjectTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kişi">
          <Select
            required
            value={invitationForm.subjectId}
            onChange={(event) => setInvitationForm((current) => ({ ...current, subjectId: event.target.value }))}
          >
            <option value="">Seç</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="E-posta">
          <Input
            required
            type="email"
            value={invitationForm.email}
            onChange={(event) => setInvitationForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>
        <Field label="Ad Soyad">
          <Input
            value={invitationForm.name}
            onChange={(event) => setInvitationForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
      </FormModal>
    </div>
  );
}

function buildSubjects(
  subjectType: InvitationSubjectType,
  students: StudentRecord[],
  guardians: GuardianRecord[],
  teachers: TeacherRecord[],
) {
  if (subjectType === "STUDENT") {
    return students.map((student) => ({ id: student.id, name: `${student.firstName} ${student.lastName}` }));
  }
  if (subjectType === "GUARDIAN") {
    return guardians.map((guardian) => ({ id: guardian.id, name: `${guardian.firstName} ${guardian.lastName}` }));
  }
  return teachers.map((teacher) => ({ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}` }));
}

function parseInvitationSubjectType(value: string | null): InvitationSubjectType | null {
  const role = value?.trim().toUpperCase();
  return role && isPortalSubjectRoleName(role) ? role : null;
}

function findSubjectName(subjectType: InvitationSubjectType, subjectId: string, references: UserSubjectReferences) {
  if (subjectType === "GUARDIAN") {
    const guardian = references.guardians.find((candidate) => candidate.id === subjectId);
    return guardian ? `${guardian.firstName} ${guardian.lastName}` : "";
  }
  if (subjectType === "STUDENT") {
    const student = references.students.find((candidate) => candidate.id === subjectId);
    return student ? `${student.firstName} ${student.lastName}` : "";
  }
  const teacher = references.teachers.find((candidate) => candidate.id === subjectId);
  return teacher ? `${teacher.firstName} ${teacher.lastName}` : "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}

function invitationStatusTone(status: InvitationStatus) {
  return status === "ACCEPTED" ? "success" : "warning";
}

function normalizeRoles(roles: Role[]) {
  return [...roles].sort();
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function maskActivationToken(token: string) {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

const tenantUserSortOptions = [
  { label: "Ad A-Z", value: "name" },
  { label: "Ad Z-A", value: "-name" },
  { label: "E-posta A-Z", value: "email" },
  { label: "E-posta Z-A", value: "-email" },
];

const identityInvitationSortOptions = [
  { label: "Ad A-Z", value: "name" },
  { label: "Ad Z-A", value: "-name" },
  { label: "E-posta A-Z", value: "email" },
  { label: "E-posta Z-A", value: "-email" },
  { label: "Bitiş eski-yeni", value: "expiresAt" },
  { label: "Bitiş yeni-eski", value: "-expiresAt" },
];

async function loadTenantUsers(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<TenantUserRecord>(accessToken, buildListUrl(`${apiBaseUrl}/tenant-users`, listQuery));
}

async function createTenantUser(accessToken: string, input: TenantUserFormPayload) {
  return apiRequest<TenantUserRecord>(accessToken, `${apiBaseUrl}/tenant-users`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function setTenantUserRoles(accessToken: string, userId: string, roles: Role[]) {
  return apiRequest<TenantUserRecord>(accessToken, `${apiBaseUrl}/tenant-users/${encodeURIComponent(userId)}/roles`, {
    body: JSON.stringify({ roles }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function loadInvitations(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<IdentityInvitationRecord>(
    accessToken,
    buildListUrl(`${apiBaseUrl}/identity-invitations`, listQuery),
  );
}

async function createInvitation(accessToken: string, input: IdentityInvitationFormPayload) {
  return apiRequest<IdentityInvitationIssueResult>(accessToken, `${apiBaseUrl}/identity-invitations`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function resendIdentityInvitation(accessToken: string, id: string) {
  return apiRequest<IdentityInvitationIssueResult>(
    accessToken,
    `${apiBaseUrl}/identity-invitations/${encodeURIComponent(id)}/resend`,
    { method: "POST" },
  );
}

async function loadUserSubjectReferences(accessToken: string): Promise<UserSubjectReferences> {
  const [guardians, students, teachers] = await Promise.all([
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/guardians`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
  ]);
  return { guardians, students, teachers };
}
