"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, FormModal, Input, Select } from "@o-okul/ui";
import type {
  ClassRecord,
  GradeLevelRecord,
  GuardianRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  StudentRecord,
  TeacherRecord,
} from "@o-okul/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import {
  firstFormError,
  studentFormSchema,
  type StudentFormPayload,
  type StudentFormState,
} from "../../../../src/form-validation.js";
import { istanbulDateKey } from "../../_shared/istanbul-date.js";
import { RevealablePhone } from "../_shared/revealable-phone.js";

export interface StudentReferences {
  classes: ClassRecord[];
  gradeLevels: GradeLevelRecord[];
  teachers: TeacherRecord[];
}

export interface EnrollmentActionState {
  startsAt: string;
  classId: string;
}

/** The part of a loaded student detail the form shows next to the fields: masked contact values and linked guardians. */
export interface StudentFormDetail {
  guardians: GuardianRecord[];
  profile: StudentProfileRecord;
}

interface StudentProfilePayload {
  nationalId?: string;
  phone?: string;
  email?: string;
}

const emptyForm: StudentFormState = {
  studentNo: "",
  firstName: "",
  lastName: "",
  gradeLevelId: "",
  classId: "",
  responsibleTeacherId: "",
  status: "ACTIVE",
  nationalId: "",
  phone: "",
  email: "",
};

const emptyEnrollmentAction: EnrollmentActionState = {
  startsAt: "",
  classId: "",
};

/** Classes, levels and teachers for the student list filters and the student form; one cache entry per tenant. */
export function useStudentReferences(enabled = true) {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ["next-student-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadStudentReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth) && enabled,
    refetchOnWindowFocus: false,
  });
}

/**
 * Create/edit form shared by the student list and Student 360. `student` null means create; after a create
 * whose profile write fails, the parent passes the created record back through `onCreated` so a retry
 * patches it instead of creating a second student.
 */
export function StudentFormModal({
  canRevealPhone,
  children,
  detail,
  detailLoading,
  onClose,
  onCreated,
  open,
  student,
}: {
  canRevealPhone: boolean;
  /** Extra read-only sections after the form fields (the list shows the Öğrenci 360 brief here). */
  children?: ReactNode;
  detail?: StudentFormDetail;
  detailLoading: boolean;
  onClose(): void;
  onCreated?(student: StudentRecord): void;
  open: boolean;
  student: StudentRecord | null;
}) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  // Student 360 loads the lists only when the form opens; the student list already has them cached.
  const referencesQuery = useStudentReferences(open);
  const classes = referencesQuery.data?.classes ?? [];
  const gradeLevels = referencesQuery.data?.gradeLevels ?? [];
  const teachers = referencesQuery.data?.teachers ?? [];
  const editingStudent = student;
  const [form, setForm] = useState<StudentFormState>(emptyForm);
  const [enrollmentAction, setEnrollmentAction] = useState<EnrollmentActionState>(emptyEnrollmentAction);
  const [isSaving, setIsSaving] = useState(false);
  const [isEnrollmentSaving, setIsEnrollmentSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // The form starts from the record each time it opens; a created student passed back while open keeps the typed values.
  const [openState, setOpenState] = useState(false);
  if (openState !== open) {
    setOpenState(open);
    if (open) {
      setForm(student ? {
        ...emptyForm,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevelId: student.gradeLevelId ?? classes.find((klass) => klass.id === student.classId)?.gradeLevelId ?? "",
        classId: student.classId ?? "",
        responsibleTeacherId: student.responsibleTeacherId ?? "",
        status: student.status,
      } : emptyForm);
      setEnrollmentAction(student ? { startsAt: istanbulDateKey(), classId: student.classId ?? "" } : emptyEnrollmentAction);
      setFormError("");
    }
  } else if (open && !form.gradeLevelId) {
    // A record without a stored level takes its class's level once the class list has loaded.
    const classGradeLevelId = classes.find((klass) => klass.id === form.classId)?.gradeLevelId;
    if (classGradeLevelId) setForm((current) => ({ ...current, gradeLevelId: classGradeLevelId }));
  }
  const formClasses = classes.filter((klass) => klass.gradeLevelId === form.gradeLevelId);

  function invalidateStudentViews() {
    void queryClient.invalidateQueries({ queryKey: ["next-students"] });
    void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["next-student-detail-page-data"] });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isSaving) return;

    const wasEditing = editingStudent;
    setFormError("");
    const parsedForm = studentFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setFormError(firstFormError(parsedForm.error));
      return;
    }

    setIsSaving(true);
    try {
      const studentForm = parsedForm.data;
      if (!wasEditing && !studentForm.gradeLevelId) {
        setFormError("Seviye seçilmelidir.");
        return;
      }
      const savedStudent = wasEditing
        ? await updateStudent(auth.accessToken, wasEditing.id, {
            firstName: studentForm.firstName,
            lastName: studentForm.lastName,
            gradeLevelId: studentForm.gradeLevelId || (wasEditing.gradeLevelId ? "" : undefined),
            classId: studentForm.classId || (wasEditing.classId ? "" : undefined),
            responsibleTeacherId: studentForm.responsibleTeacherId,
            status: studentForm.status,
          })
        : await createStudent(auth.accessToken, {
            studentNo: studentForm.studentNo || undefined,
            firstName: studentForm.firstName,
            lastName: studentForm.lastName,
            gradeLevelId: studentForm.gradeLevelId || undefined,
            classId: studentForm.classId || undefined,
            responsibleTeacherId: studentForm.responsibleTeacherId || undefined,
            status: studentForm.status,
          });

      if (!wasEditing) {
        onCreated?.(savedStudent);
      }
      void queryClient.invalidateQueries({ queryKey: ["next-students"] });

      const profilePayload = buildProfilePayload(studentForm);
      if (profilePayload) {
        await updateStudentProfile(auth.accessToken, savedStudent.id, profilePayload);
      }

      invalidateStudentViews();
      onClose();
    } catch {
      setFormError("Öğrenci kaydedilemedi. TC geçerli ve benzersiz olmalı, e-posta geçerli olmalı, kota dolmamalı.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRenewEnrollment() {
    if (!auth || !editingStudent || isEnrollmentSaving) return;

    setFormError("");
    setIsEnrollmentSaving(true);
    try {
      await renewStudentEnrollment(auth.accessToken, editingStudent.id, {
        classId: enrollmentAction.classId,
        startsAt: enrollmentAction.startsAt,
      });
      setForm((current) => ({ ...current, classId: enrollmentAction.classId, status: "ACTIVE" }));
      invalidateStudentViews();
    } catch {
      setFormError("Kayıt yenileme yapılamadı.");
    } finally {
      setIsEnrollmentSaving(false);
    }
  }

  async function handleTransferEnrollment() {
    if (!auth || !editingStudent || isEnrollmentSaving) return;

    setFormError("");
    setIsEnrollmentSaving(true);
    try {
      await transferStudentEnrollment(auth.accessToken, editingStudent.id, {
        classId: enrollmentAction.classId,
        startsAt: enrollmentAction.startsAt,
      });
      setForm((current) => ({
        ...current,
        classId: enrollmentAction.classId,
        status: enrollmentAction.classId ? "ACTIVE" : "TRANSFERRED",
      }));
      invalidateStudentViews();
    } catch {
      setFormError("Nakil işlemi yapılamadı.");
    } finally {
      setIsEnrollmentSaving(false);
    }
  }

  return (
    <FormModal
      description={editingStudent ? "Ad ve soyad zorunludur. Diğer alanlar opsiyoneldir." : "Ad, soyad ve seviye zorunludur. Sınıf ve diğer alanlar opsiyoneldir."}
      onCancel={onClose}
      onSubmit={(event) => void handleSubmit(event)}
      open={open}
      submitError={formError || undefined}
      submitLabel={isSaving ? "Kaydediliyor…" : editingStudent ? "Kaydet" : "Ekle"}
      submitting={isSaving}
      title={editingStudent ? "Öğrenci düzenle" : "Öğrenci ekle"}
    >
      <Field label="Ad">
        <Input
          required
          value={form.firstName}
          onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
        />
      </Field>
      <Field label="Soyad">
        <Input
          required
          value={form.lastName}
          onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
        />
      </Field>
      {!editingStudent ? (
        <Field label="Okul No" description="Boş bırakılırsa sistem sıradaki numarayı verir.">
          <Input
            value={form.studentNo}
            onChange={(event) => setForm((current) => ({ ...current, studentNo: event.target.value }))}
          />
        </Field>
      ) : null}
      <Field label="Seviye" description="Seviye zorunludur; sınıf seçmeden de öğrenci kaydedilebilir.">
        <Select
          required={!editingStudent}
          value={form.gradeLevelId}
          onChange={(event) => {
            const gradeLevelId = event.target.value;
            setForm((current) => ({
              ...current,
              gradeLevelId,
              classId: classes.some((klass) => klass.id === current.classId && klass.gradeLevelId === gradeLevelId)
                ? current.classId
                : "",
            }));
          }}
        >
          <option value="">Seviye seçiniz</option>
          {gradeLevels.map((gradeLevel) => (
            <option key={gradeLevel.id} value={gradeLevel.id}>
              {gradeLevel.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sınıf" description="Sınıf bağlantısı rapor, devamsızlık, ödeme ve portal bağlamını besler.">
        <Select
          value={form.classId}
          onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
        >
          <option value="">Sınıfsız</option>
          {formClasses.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sorumlu öğretmen">
        <Select
          value={form.responsibleTeacherId}
          onChange={(event) => setForm((current) => ({ ...current, responsibleTeacherId: event.target.value }))}
        >
          <option value="">Atanmadı</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.firstName} {teacher.lastName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kayıt durumu">
        <Select
          value={form.status}
          onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as StudentRecord["status"] }))}
        >
          <option value="ACTIVE">Aktif</option>
          <option value="PASSIVE">Pasif</option>
          <option value="GRADUATED">Mezun</option>
          <option value="TRANSFERRED">Nakil</option>
        </Select>
      </Field>
      <Field
        label="TC Kimlik No"
        description={detail?.profile.nationalIdMasked ? `Kayıtlı: ${detail.profile.nationalIdMasked}` : undefined}
      >
        <Input
          inputMode="numeric"
          maxLength={11}
          value={form.nationalId}
          onChange={(event) => setForm((current) => ({ ...current, nationalId: event.target.value }))}
        />
      </Field>
      <Field
        label="Telefon"
        description={detail?.profile.phone || detail?.profile.phoneMasked ? `Kayıtlı: ${detail.profile.phone ? maskPhoneNumber(detail.profile.phone) : detail.profile.phoneMasked}` : undefined}
      >
        <Input
          inputMode="tel"
          value={form.phone}
          onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
        />
      </Field>
      <Field
        label="E-posta"
        description={detail?.profile.email || detail?.profile.emailMasked ? `Kayıtlı: ${detail.profile.email ? maskEmail(detail.profile.email) : detail.profile.emailMasked}` : undefined}
      >
        <Input
          type="email"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
        />
      </Field>
      <div className="next-form-section">
        <p className="next-form-section-title">Veli</p>
        {editingStudent ? (
          <div className="next-form-guardians">
            <span className="next-field-hint">Bağlı veliler</span>
            {detail && detail.guardians.length > 0 ? (
              <ul>
                {detail.guardians.map((guardian) => (
                  <li key={guardian.id}>
                    <span>{guardian.firstName} {guardian.lastName}</span>
                    <RevealablePhone canReveal={canRevealPhone && Boolean(guardian.phone)} value={guardian.phone ?? guardian.phoneMasked} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="next-field-hint">{detailLoading ? "Yükleniyor…" : "Bağlı veli yok"}</span>
            )}
          </div>
        ) : null}
        <p className="next-field-hint">Veli hesabı Veliler ekranından açılır, öğrenciye bağlanır ve davet edilir. İletişim kişisi öğrenci detayından eklenir.</p>
      </div>
      {editingStudent ? (
        <section className="next-form-section" aria-label="Kayıt işlemleri">
          <p className="next-form-section-title">Kayıt işlemleri</p>
          <Field label="İşlem tarihi">
            <Input
              type="date"
              value={enrollmentAction.startsAt}
              onChange={(event) => setEnrollmentAction((current) => ({ ...current, startsAt: event.target.value }))}
            />
          </Field>
          <Field label="Yeni sınıf">
            <Select
              value={enrollmentAction.classId}
              onChange={(event) => setEnrollmentAction((current) => ({ ...current, classId: event.target.value }))}
            >
              <option value="">Kurumdan ayrıldı</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="next-form-actions">
            <Button type="button" onClick={() => void handleRenewEnrollment()} disabled={isEnrollmentSaving}>
              Kayıt yenile
            </Button>
            <Button type="button" variant="secondary" onClick={() => void handleTransferEnrollment()} disabled={isEnrollmentSaving}>
              Nakil işle
            </Button>
          </div>
        </section>
      ) : null}
      {children}
    </FormModal>
  );
}

function buildProfilePayload(form: StudentFormPayload): StudentProfilePayload | null {
  const payload: StudentProfilePayload = {};
  if (form.nationalId.trim()) payload.nationalId = form.nationalId.trim();
  if (form.phone.trim()) payload.phone = form.phone.trim();
  if (form.email.trim()) payload.email = form.email.trim();
  return Object.keys(payload).length > 0 ? payload : null;
}

async function loadStudentReferences(accessToken: string): Promise<StudentReferences> {
  const [classes, gradeLevels, teachers] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<GradeLevelRecord[]>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
  ]);
  return { classes, gradeLevels, teachers };
}

async function createStudent(
  accessToken: string,
  input: {
    studentNo?: string;
    firstName: string;
    lastName: string;
    gradeLevelId?: string;
    classId?: string;
    responsibleTeacherId?: string;
    status: StudentRecord["status"];
  },
) {
  return apiRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateStudent(
  accessToken: string,
  id: string,
  input: { firstName: string; lastName: string; gradeLevelId?: string; classId?: string; responsibleTeacherId?: string; status: StudentRecord["status"] },
) {
  return apiRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function updateStudentProfile(accessToken: string, id: string, input: StudentProfilePayload) {
  return apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function renewStudentEnrollment(accessToken: string, id: string, input: EnrollmentActionState) {
  return apiRequest<StudentEnrollmentRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments/renew`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function transferStudentEnrollment(accessToken: string, id: string, input: EnrollmentActionState) {
  return apiRequest<StudentEnrollmentRecord | null>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments/transfer`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  const suffix = digits.slice(-2).padStart(2, "•");
  return `••• ••• ••${suffix}`;
}

function maskEmail(value: string) {
  const [localPart = "", domain = ""] = value.split("@");
  if (!localPart || !domain) return "E-posta kayıtlı";
  const visiblePrefix = localPart.slice(0, 2);
  return `${visiblePrefix}${"•".repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
}
