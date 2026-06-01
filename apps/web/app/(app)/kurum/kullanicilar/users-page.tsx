"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { GuardianRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { Plus, RotateCcw, Save, Send } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
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
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

type Role = "TENANT_ADMIN" | "TEACHER" | "STUDENT" | "GUARDIAN";
type InvitationSubjectType = "STUDENT" | "GUARDIAN" | "TEACHER";
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

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: "TENANT_ADMIN", label: "Kurum admin" },
  { value: "TEACHER", label: "Öğretmen" },
  { value: "STUDENT", label: "Öğrenci" },
  { value: "GUARDIAN", label: "Veli" },
];

const subjectTypeLabels: Record<InvitationSubjectType, string> = {
  GUARDIAN: "Veli",
  STUDENT: "Öğrenci",
  TEACHER: "Öğretmen",
};

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

export function UsersPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [userListQuery, setUserListQuery] = useState<ListQueryState>(initialListQuery);
  const [invitationListQuery, setInvitationListQuery] = useState<ListQueryState>(initialListQuery);
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
  const studentsQuery = useQuery({
    queryKey: ["next-students", tenantId],
    queryFn: () => loadStudents(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const guardiansQuery = useQuery({
    queryKey: ["next-guardians", tenantId],
    queryFn: () => loadGuardians(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const teachersQuery = useQuery({
    queryKey: ["next-teachers", tenantId],
    queryFn: () => loadTeachers(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role[]>>({});
  const [isUserFormOpen, setIsUserFormOpen] = useState(false);
  const [userForm, setUserForm] = useState<TenantUserFormState>(emptyUserForm);
  const [isInvitationFormOpen, setIsInvitationFormOpen] = useState(false);
  const [invitationForm, setInvitationForm] = useState<IdentityInvitationFormState>(emptyInvitationForm);
  const [issuedToken, setIssuedToken] = useState<{ email: string; token: string } | null>(null);
  const [error, setError] = useState("");

  const users = usersQuery.data?.data ?? [];
  const invitations = invitationsQuery.data?.data ?? [];
  const subjects = useMemo(
    () => buildSubjects(invitationForm.subjectType, studentsQuery.data ?? [], guardiansQuery.data ?? [], teachersQuery.data ?? []),
    [guardiansQuery.data, invitationForm.subjectType, studentsQuery.data, teachersQuery.data],
  );

  const userColumns: Array<DataTableColumn<TenantUserRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      render: (user) => user.name,
    },
    {
      key: "email",
      header: "E-posta",
      render: (user) => user.email,
    },
    {
      key: "roles",
      header: "Roller",
      render: (user) => (
        <div className="next-role-checks" aria-label={`${user.name} rolleri`}>
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
        </div>
      ),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (user) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => void saveRoles(user)} aria-label={`${user.name} rollerini kaydet`}>
            <Save size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  const invitationColumns: Array<DataTableColumn<IdentityInvitationRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      render: (invitation) => invitation.name,
    },
    {
      key: "email",
      header: "E-posta",
      render: (invitation) => invitation.email,
    },
    {
      key: "subject",
      header: "Kişi",
      render: (invitation) => subjectTypeLabels[invitation.subjectType],
    },
    {
      key: "status",
      header: "Durum",
      render: (invitation) => statusLabels[invitation.status],
    },
    {
      key: "expiresAt",
      header: "Bitiş",
      render: (invitation) => formatDate(invitation.expiresAt),
    },
    {
      key: "actions",
      header: "İşlem",
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
    },
  ];

  function getDraftRoles(user: TenantUserRecord) {
    return roleDrafts[user.id] ?? user.roles;
  }

  function toggleRole(userId: string, role: Role) {
    setRoleDrafts((current) => {
      const user = users.find((candidate) => candidate.id === userId);
      const roles = current[userId] ?? user?.roles ?? [];
      const nextRoles = roles.includes(role) ? roles.filter((candidate) => candidate !== role) : [...roles, role];
      return { ...current, [userId]: nextRoles };
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
    } catch {
      setError("Roller kaydedilemedi.");
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
    } catch {
      setError("Kullanıcı oluşturulamadı.");
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
      setIsInvitationFormOpen(false);
      setInvitationForm(emptyInvitationForm);
    } catch {
      setError("Davet oluşturulamadı.");
    }
  }

  async function resendInvitation(invitation: IdentityInvitationRecord) {
    if (!auth) return;

    setError("");
    try {
      const issued = await resendIdentityInvitation(auth.accessToken, invitation.id);
      void queryClient.invalidateQueries({ queryKey: invitationsListQueryKey });
      setIssuedToken({ email: issued.invitation.email, token: issued.activationToken });
    } catch {
      setError("Davet yenilenemedi.");
    }
  }

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
            <Button onClick={openUserForm} variant="secondary">
              <Plus size={17} aria-hidden="true" />
              Kullanıcı ekle
            </Button>
            <Button onClick={openInvitationForm}>
              <Send size={17} aria-hidden="true" />
              Davet oluştur
            </Button>
          </>
        }
        aria-label="Kullanıcı ve rol yönetimi"
        columns={userColumns}
        description="Kurum kullanıcılarını ve tenant rollerini yönet."
        emptyText="Kullanıcı kaydı yok"
        error={error || (usersQuery.isError ? "Kullanıcılar alınamadı." : undefined)}
        getRowKey={(user) => user.id}
        loading={usersQuery.isPending}
        rows={users}
        title="Kullanıcılar"
      />
      {issuedToken ? (
        <section className="next-token-panel" aria-label="Son aktivasyon tokenı">
          <strong>{issuedToken.email}</strong>
          <code>{issuedToken.token}</code>
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
        description="Öğrenci, veli ve öğretmen hesap aktivasyonlarını takip et."
        emptyText="Davet kaydı yok"
        error={invitationsQuery.isError ? "Davetler alınamadı." : undefined}
        getRowKey={(invitation) => invitation.id}
        loading={invitationsQuery.isPending}
        rows={invitations}
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
        <label>
          E-posta
          <Input
            required
            type="email"
            value={userForm.email}
            onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>
        <label>
          Ad Soyad
          <Input
            required
            value={userForm.name}
            onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Şifre
          <Input
            minLength={8}
            required
            type="password"
            value={userForm.password}
            onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
          />
        </label>
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
        <label>
          Kişi türü
          <select
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
          </select>
        </label>
        <label>
          Kişi
          <select
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
          </select>
        </label>
        <label>
          E-posta
          <Input
            required
            type="email"
            value={invitationForm.email}
            onChange={(event) => setInvitationForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>
        <label>
          Ad Soyad
          <Input
            value={invitationForm.name}
            onChange={(event) => setInvitationForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
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

async function loadStudents(accessToken: string) {
  return apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`);
}

async function loadGuardians(accessToken: string) {
  return apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/guardians`);
}

async function loadTeachers(accessToken: string) {
  return apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`);
}
