"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClassRecord, ExamParticipantRecord, ExamRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { Button, EmptyState, FormModal, Input } from "@uzman-hocam/ui";
import { CheckCircle2, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiErrorMessage, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  examWithClassFormSchema,
  firstFormError,
  type ExamWithClassFormPayload,
  type ExamWithClassFormState,
} from "../../../../src/form-validation.js";
import { PageFrame } from "../_shared/page-frame.js";

const emptyForm: ExamWithClassFormState = {
  title: "",
  startsAt: "",
  classIds: [],
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
  const [form, setForm] = useState<ExamWithClassFormState>(emptyForm);
  const [editingExam, setEditingExam] = useState<ExamRecord | null>(null);
  const [classSearch, setClassSearch] = useState("");
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
  const classById = new Map(classes.map((klass) => [klass.id, klass]));
  const studentCountByClassId = countStudentsByClassId(students);
  const normalizedClassSearch = classSearch.trim().toLocaleLowerCase("tr-TR");
  const visibleClasses = normalizedClassSearch
    ? classes.filter((klass) => classSearchText(klass).toLocaleLowerCase("tr-TR").includes(normalizedClassSearch))
    : classes;
  const selectedClassCount = form.classIds.length;
  const selectedStudentCount = form.classIds.reduce((total, classId) => total + (studentCountByClassId.get(classId) ?? 0), 0);
  const participantsNotFound = participantsQuery.error instanceof ApiRequestError && participantsQuery.error.status === 404;

  useEffect(() => {
    if (!participantsNotFound || !auth) return;

    setSelectedExamId("");
    void queryClient.invalidateQueries({ queryKey: ["next-exams", auth.session.tenantId] });
  }, [auth, participantsNotFound, queryClient]);

  function openCreateForm() {
    setForm(emptyForm);
    setEditingExam(null);
    setClassSearch("");
    setError("");
    setIsFormOpen(true);
  }

  async function openEditForm(exam: ExamRecord) {
    if (!auth) return;

    setError("");
    setSelectedExamId(exam.id);
    let examParticipants = exam.id === activeExamId ? participants : [];
    if (exam.id !== activeExamId || !participantsQuery.data) {
      try {
        examParticipants = await loadParticipants(auth.accessToken, exam.id);
      } catch (participantsError) {
        setError(apiErrorMessage(participantsError, "Katılımcı verisi alınamadı."));
      }
    }
    setEditingExam(exam);
    setForm({
      title: exam.title,
      startsAt: toDateTimeLocal(exam.startsAt),
      classIds: classIdsFromParticipants(examParticipants, studentById),
    });
    setClassSearch("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setForm(emptyForm);
    setEditingExam(null);
    setClassSearch("");
    setIsFormOpen(false);
  }

  function toggleClassSelection(classId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      classIds: checked
        ? current.classIds.includes(classId)
          ? current.classIds
          : [...current.classIds, classId]
        : current.classIds.filter((currentClassId) => currentClassId !== classId),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = examWithClassFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedExam = editingExam
        ? await updateExam(auth.accessToken, editingExam.id, parsedForm.data)
        : await createExam(auth.accessToken, parsedForm.data);
      queryClient.setQueryData<ExamRecord[]>(queryKey, (current) => [
        savedExam,
        ...(current ?? []).filter((exam) => exam.id !== savedExam.id),
      ]);
      setSelectedExamId(savedExam.id);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-exam-participants", auth.session.tenantId, savedExam.id] });
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Sınav kaydedilemedi."));
    }
  }

  async function handlePublish(exam: ExamRecord) {
    if (!auth) return;

    setError("");
    try {
      await publishExam(auth.accessToken, exam.id);
      void queryClient.invalidateQueries({ queryKey });
    } catch (publishError) {
      setError(apiErrorMessage(publishError, "Sınav yayınlanamadı."));
    }
  }

  async function handleDelete(exam: ExamRecord) {
    if (!auth) return;
    if (!window.confirm(`${exam.title} sınavı ve ona ait tüm optik, sonuç ve rapor kayıtları silinsin mi?`)) return;

    setError("");
    try {
      await deleteExam(auth.accessToken, exam.id);
      if (selectedExamId === exam.id) {
        setSelectedExamId("");
      }
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-exam-participants", auth.session.tenantId] });
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, "Sınav silinemedi."));
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
        {error || examsQuery.isError ? (
          <p className="uh-crud-page__error">{error || apiErrorMessage(examsQuery.error, "Sınavlar alınamadı.")}</p>
        ) : null}
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
                    <button type="button" onClick={() => void openEditForm(exam)} aria-label={`${exam.title} düzenle`}>
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                    {exam.status === "DRAFT" ? (
                      <button type="button" onClick={() => void handlePublish(exam)} aria-label={`${exam.title} yayınla`}>
                        <CheckCircle2 size={17} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void handleDelete(exam)} aria-label={`${exam.title} sil`}>
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
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
              <p>Katılımcılar sınav oluşturulurken seçilen sınıftan otomatik eklenir.</p>
            </div>
          </div>
          <table className="uh-data-table">
            <thead>
              <tr>
                <th>Öğrenci</th>
                <th>Öğrenci no</th>
                <th>Sınıf</th>
                <th>Katılım no</th>
                <th>Kitapçık</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const student = studentById.get(participant.studentId);
                return (
                  <tr key={participant.id}>
                    <td>{studentName(student)}</td>
                    <td>{student?.studentNo ?? "-"}</td>
                    <td>{classLabel(student?.classId, classById)}</td>
                    <td>{participant.participantNo ?? "-"}</td>
                    <td>{participant.bookletType ?? "-"}</td>
                    <td>{participantStatusLabel(participant.status)}</td>
                  </tr>
                );
              })}
              {participants.length === 0 && !participantsQuery.isPending && !participantsQuery.isError ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="Katılımcı yok"
                      description="Bu sınav oluşturulurken seçilen sınıfta öğrenci bulunamadı."
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {participantsQuery.isPending ? <p className="next-status-note">Katılımcılar yükleniyor</p> : null}
          {referencesQuery.isError || participantsQuery.isError ? (
            <p className="uh-crud-page__error">
              {participantsNotFound ? "Seçili sınav bulunamadı. Liste yenileniyor." : "Katılımcı verisi alınamadı."}
            </p>
          ) : null}
        </section>
      ) : null}
      <FormModal
        description="Sınav adı zorunludur. Başlangıç tarihi isteğe bağlıdır."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingExam ? "Kaydet" : "Ekle"}
        title={editingExam ? "Sınav düzenle" : "Sınav ekle"}
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
        <div className="next-field-group">
          <div className="next-class-picker-header">
            <span>Sınıflar</span>
            <div className="next-class-picker-actions">
              <span className="next-class-picker-count" aria-live="polite">
                {selectedClassCount} sınıf / {selectedStudentCount} öğrenci
              </span>
              {selectedClassCount > 0 ? (
                <button
                  aria-label="Seçili sınıfları temizle"
                  className="next-class-picker-clear"
                  onClick={() => setForm((current) => ({ ...current, classIds: [] }))}
                  type="button"
                >
                  <X size={14} aria-hidden="true" />
                  Temizle
                </button>
              ) : null}
            </div>
          </div>
          <div className="next-class-search">
            <Search className="next-class-search__icon" size={16} aria-hidden="true" />
            <Input
              aria-label="Sınıf ara"
              className="next-class-search__input"
              placeholder="Sınıf adı yaz"
              value={classSearch}
              onChange={(event) => setClassSearch(event.target.value)}
            />
            {classSearch ? (
              <button
                aria-label="Sınıf aramasını temizle"
                className="next-class-search__clear"
                onClick={() => setClassSearch("")}
                type="button"
              >
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="next-checkbox-list" role="group" aria-label="Sınıflar">
            {visibleClasses.map((klass) => {
              const checked = form.classIds.includes(klass.id);
              const meta = classMeta(klass);
              const studentCount = studentCountByClassId.get(klass.id) ?? 0;
              return (
                <label key={klass.id} className="next-checkbox-option">
                  <input
                    checked={checked}
                    name="classIds"
                    onChange={(event) => toggleClassSelection(klass.id, event.target.checked)}
                    type="checkbox"
                    value={klass.id}
                  />
                  <span className="next-checkbox-option__content">
                    <span>{klass.name}</span>
                    <small>{[meta, `${studentCount} öğrenci`].filter(Boolean).join(" / ")}</small>
                  </span>
                </label>
              );
            })}
            {classes.length === 0 && !referencesQuery.isPending ? <p className="next-class-picker-empty">Sınıf bulunamadı.</p> : null}
            {classes.length > 0 && visibleClasses.length === 0 ? (
              <p className="next-class-picker-empty">Eşleşen sınıf bulunamadı.</p>
            ) : null}
          </div>
          {referencesQuery.isPending ? <p className="next-field-help">Sınıflar yükleniyor.</p> : null}
        </div>
      </FormModal>
    </PageFrame>
  );
}

async function loadExams(accessToken: string) {
  return apiRequest<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
}

async function createExam(accessToken: string, input: ExamWithClassFormPayload) {
  return apiRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateExam(accessToken: string, id: string, input: ExamWithClassFormPayload) {
  return apiRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function publishExam(accessToken: string, id: string) {
  return apiRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

async function deleteExam(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("EXAM_DELETE_FAILED");
  }
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

function classLabel(classId: string | undefined, classById: Map<string, ClassRecord>) {
  if (!classId) return "-";
  return classById.get(classId)?.name ?? classId;
}

function participantStatusLabel(status: string) {
  if (status === "REGISTERED") return "Kayıtlı";
  if (status === "ATTENDED") return "Katıldı";
  if (status === "ABSENT") return "Gelmedi";
  return status;
}

function classSearchText(record: ClassRecord) {
  return [record.name, record.level, record.section].filter(Boolean).join(" ");
}

function classMeta(record: ClassRecord) {
  return [record.level, record.section].filter(Boolean).join(" / ");
}

function classIdsFromParticipants(participants: ExamParticipantRecord[], studentById: Map<string, StudentRecord>) {
  return [
    ...new Set(
      participants
        .map((participant) => studentById.get(participant.studentId)?.classId)
        .filter((classId): classId is string => Boolean(classId)),
    ),
  ];
}

function toDateTimeLocal(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function countStudentsByClassId(students: StudentRecord[]) {
  const counts = new Map<string, number>();

  for (const student of students) {
    if (!student.classId) continue;
    counts.set(student.classId, (counts.get(student.classId) ?? 0) + 1);
  }

  return counts;
}
