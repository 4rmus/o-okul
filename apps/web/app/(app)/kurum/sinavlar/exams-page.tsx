"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClassRecord, ExamParticipantRecord, ExamRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { Button, EmptyState, FormModal, Input } from "@uzman-hocam/ui";
import { CheckCircle2, Plus, Users } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import {
  examParticipantFormSchema,
  examFormSchema,
  firstFormError,
  type ExamParticipantFormPayload,
  type ExamParticipantFormState,
  type ExamFormPayload,
  type ExamFormState,
} from "../../../../src/form-validation.js";
import { PageFrame } from "../_shared/page-frame.js";

const emptyForm: ExamFormState = {
  title: "",
  startsAt: "",
};

const emptyParticipantForm: ExamParticipantFormState = {
  studentId: "",
  participantNo: "",
  bookletType: "",
};

const emptyBulkParticipantForm = {
  classId: "",
  studentIds: [] as string[],
  participantNoStart: "",
  bookletType: "",
};

interface ExamPageReferences {
  classes: ClassRecord[];
  students: StudentRecord[];
}

export function ExamsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["next-exams", auth?.session.tenantId ?? "anonymous"];
  const examsQuery = useQuery({
    queryKey,
    queryFn: () => loadExams(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["next-exam-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadExamReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<ExamFormState>(emptyForm);
  const [participantForm, setParticipantForm] = useState<ExamParticipantFormState>(emptyParticipantForm);
  const [bulkParticipantForm, setBulkParticipantForm] = useState(emptyBulkParticipantForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [error, setError] = useState("");
  const rows = examsQuery.data ?? [];
  const selectedExam = rows.find((exam) => exam.id === selectedExamId) ?? rows[0];
  const activeExamId = selectedExam?.id ?? "";
  const participantsQueryKey = ["next-exam-participants", auth?.session.tenantId ?? "anonymous", activeExamId];
  const participantsQuery = useQuery({
    queryKey: participantsQueryKey,
    queryFn: () => loadParticipants(auth?.accessToken ?? "", activeExamId),
    enabled: Boolean(auth && activeExamId),
    refetchOnWindowFocus: false,
  });
  const participants = participantsQuery.data ?? [];
  const students = referencesQuery.data?.students ?? [];
  const studentById = new Map(students.map((student) => [student.id, student]));
  const classes = referencesQuery.data?.classes ?? [];
  const participantStudentIds = new Set(participants.map((participant) => participant.studentId));
  const availableStudents = students.filter((student) => !participantStudentIds.has(student.id));
  const bulkStudents = availableStudents.filter(
    (student) => !bulkParticipantForm.classId || student.classId === bulkParticipantForm.classId,
  );

  function openCreateForm() {
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setForm(emptyForm);
    setIsFormOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = examFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await createExam(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey });
      closeForm();
    } catch {
      setError("Sınav kaydedilemedi.");
    }
  }

  async function handlePublish(exam: ExamRecord) {
    if (!auth) return;

    setError("");
    try {
      await publishExam(auth.accessToken, exam.id);
      void queryClient.invalidateQueries({ queryKey });
    } catch {
      setError("Sınav yayınlanamadı.");
    }
  }

  async function handleAddParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !activeExamId) return;

    setError("");
    const parsedForm = examParticipantFormSchema.safeParse(participantForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await addParticipant(auth.accessToken, activeExamId, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: participantsQueryKey });
      setParticipantForm(emptyParticipantForm);
    } catch {
      setError("Katılımcı eklenemedi.");
    }
  }

  async function handleBulkAddParticipants(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !activeExamId) return;

    setError("");
    if (bulkParticipantForm.studentIds.length === 0) {
      setError("En az bir öğrenci seçilmelidir.");
      return;
    }
    const participantNoStart = bulkParticipantForm.participantNoStart.trim()
      ? Number(bulkParticipantForm.participantNoStart)
      : undefined;
    if (participantNoStart !== undefined && (!Number.isInteger(participantNoStart) || participantNoStart <= 0)) {
      setError("Başlangıç no pozitif tam sayı olmalıdır.");
      return;
    }

    try {
      await Promise.all(
        bulkParticipantForm.studentIds.map((studentId, index) =>
          addParticipant(auth.accessToken, activeExamId, {
            studentId,
            ...(participantNoStart ? { participantNo: String(participantNoStart + index) } : {}),
            ...(bulkParticipantForm.bookletType.trim() ? { bookletType: bulkParticipantForm.bookletType.trim() } : {}),
          }),
        ),
      );
      void queryClient.invalidateQueries({ queryKey: participantsQueryKey });
      setBulkParticipantForm(emptyBulkParticipantForm);
    } catch {
      setError("Toplu katılımcı eklenemedi.");
    }
  }

  return (
    <PageFrame
      title="Sınavlar"
      subtitle="Deneme sınavlarını oluştur, yayın durumunu takip et ve rapor zincirine hazırla."
      actions={
        <Button onClick={openCreateForm}>
          <Plus size={17} aria-hidden="true" />
          Sınav ekle
        </Button>
      }
    >
      <section className="next-list-panel" aria-label="Sınav yönetimi">
        <h2>Sınav yönetimi</h2>
        {error || examsQuery.isError ? <p className="uh-crud-page__error">{error || "Sınavlar alınamadı."}</p> : null}
        <table className="uh-data-table">
          <thead>
            <tr>
              <th>Sınav</th>
              <th>Durum</th>
              <th>Başlangıç</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((exam) => (
              <tr key={exam.id}>
                <td>{exam.title}</td>
                <td>{examStatusLabel(exam.status)}</td>
                <td>{formatDateTime(exam.startsAt)}</td>
                <td>
                  <div className="next-row-actions">
                    {exam.status === "PUBLISHED" ? <span>Yayında</span> : null}
                    <button type="button" onClick={() => setSelectedExamId(exam.id)} aria-label={`${exam.title} katılımcıları`}>
                      <Users size={17} aria-hidden="true" />
                    </button>
                    {exam.status === "DRAFT" ? (
                      <button type="button" onClick={() => void handlePublish(exam)} aria-label={`${exam.title} yayınla`}>
                        <CheckCircle2 size={17} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !examsQuery.isPending ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    title="Henüz sınav yok"
                    description="İlk deneme sınavını ekleyerek katılımcı ve rapor hazırlığını başlat."
                    primaryAction={{ label: "Sınav ekle", onClick: openCreateForm }}
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {examsQuery.isPending ? <p className="next-status-note">Sınavlar yükleniyor</p> : null}
      {selectedExam ? (
        <section className="next-subsection" aria-label="Sınav katılımcıları">
          <div className="next-section-header">
            <div>
              <h2>{selectedExam.title} katılımcıları</h2>
              <p>Öğrenciyi sınava ekle ve kayıt durumunu takip et.</p>
            </div>
          </div>
          <form className="next-inline-form" aria-label="Tekil katılımcı ekleme" onSubmit={(event) => void handleAddParticipant(event)}>
            <label>
              Öğrenci
              <select
                value={participantForm.studentId}
                onChange={(event) => setParticipantForm((current) => ({ ...current, studentId: event.target.value }))}
              >
                <option value="">Seçiniz</option>
                {availableStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {studentName(student)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Katılımcı no
              <Input
                value={participantForm.participantNo ?? ""}
                onChange={(event) => setParticipantForm((current) => ({ ...current, participantNo: event.target.value }))}
              />
            </label>
            <label>
              Kitapçık
              <Input
                value={participantForm.bookletType ?? ""}
                onChange={(event) => setParticipantForm((current) => ({ ...current, bookletType: event.target.value }))}
              />
            </label>
            <Button type="submit">Katılımcı ekle</Button>
          </form>
          <form className="next-subsection" aria-label="Toplu katılımcı ekleme" onSubmit={(event) => void handleBulkAddParticipants(event)}>
            <div className="next-inline-form">
              <label>
                Sınıf
                <select
                  value={bulkParticipantForm.classId}
                  onChange={(event) =>
                    setBulkParticipantForm((current) => ({ ...current, classId: event.target.value, studentIds: [] }))
                  }
                >
                  <option value="">Tüm öğrenciler</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Öğrenciler
                <select
                  multiple
                  value={bulkParticipantForm.studentIds}
                  onChange={(event) => {
                    const studentIds = selectedValues(event.currentTarget);
                    setBulkParticipantForm((current) => ({
                      ...current,
                      studentIds,
                    }));
                  }}
                >
                  {bulkStudents.map((student) => (
                    <option key={student.id} value={student.id}>
                      {studentName(student)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Başlangıç no
                <Input
                  type="number"
                  min={1}
                  value={bulkParticipantForm.participantNoStart}
                  onChange={(event) =>
                    setBulkParticipantForm((current) => ({ ...current, participantNoStart: event.target.value }))
                  }
                />
              </label>
              <label>
                Kitapçık
                <Input
                  value={bulkParticipantForm.bookletType}
                  onChange={(event) => setBulkParticipantForm((current) => ({ ...current, bookletType: event.target.value }))}
                />
              </label>
              <Button type="submit">Toplu ekle</Button>
            </div>
          </form>
          <table className="uh-data-table">
            <thead>
              <tr>
                <th>Öğrenci</th>
                <th>No</th>
                <th>Kitapçık</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => (
                <tr key={participant.id}>
                  <td>{studentName(studentById.get(participant.studentId))}</td>
                  <td>{participant.participantNo ?? "-"}</td>
                  <td>{participant.bookletType ?? "-"}</td>
                  <td>{participantStatusLabel(participant.status)}</td>
                </tr>
              ))}
              {participants.length === 0 && !participantsQuery.isPending ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="Katılımcı yok"
                      description="Bu sınava öğrenci eklemek için tekil veya toplu katılımcı formunu kullan."
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {participantsQuery.isPending ? <p className="next-status-note">Katılımcılar yükleniyor</p> : null}
          {referencesQuery.isError || participantsQuery.isError ? <p className="uh-crud-page__error">Katılımcı verisi alınamadı.</p> : null}
        </section>
      ) : null}
      <FormModal
        description="Sınav adı zorunludur. Başlangıç tarihi isteğe bağlıdır."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Ekle"
        title="Sınav ekle"
      >
        <label>
          Sınav adı
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          Başlangıç
          <Input
            type="datetime-local"
            value={form.startsAt ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </label>
      </FormModal>
    </PageFrame>
  );
}

async function loadExams(accessToken: string) {
  return apiRequest<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
}

async function createExam(accessToken: string, input: ExamFormPayload) {
  return apiRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function publishExam(accessToken: string, id: string) {
  return apiRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

async function loadExamReferences(accessToken: string): Promise<ExamPageReferences> {
  const [classes, students] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
  ]);
  return { classes, students };
}

async function loadParticipants(accessToken: string, examId: string) {
  return apiRequest<ExamParticipantRecord[]>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/participants`);
}

async function addParticipant(
  accessToken: string,
  examId: string,
  input: { studentId: string; participantNo?: string; bookletType?: string },
) {
  return apiRequest<ExamParticipantRecord>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/participants`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function examStatusLabel(status: string) {
  if (status === "PUBLISHED") return "Yayında";
  if (status === "DRAFT") return "Taslak";
  return status;
}

function formatDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

function studentName(student: StudentRecord | undefined) {
  return student ? `${student.firstName} ${student.lastName}` : "-";
}

function participantStatusLabel(status: string) {
  if (status === "REGISTERED") return "Kayıtlı";
  if (status === "ATTENDED") return "Katıldı";
  if (status === "ABSENT") return "Gelmedi";
  return status;
}

function selectedValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map((option) => option.value);
}
