"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClassRecord, ExamParticipantRecord, ExamRecord, StudentRecord } from "@o-okul/shared-types";
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FormModal,
  InfoGrid,
  InfoItem,
  Input,
  Panel,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
  useConfirmDialog,
} from "@o-okul/ui";
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
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: ExamWithClassFormState = {
  title: "",
  startsAt: "",
  classIds: [],
};

interface ExamPageReferences {
  classes: ClassRecord[];
  students: StudentRecord[];
}

type CreateExamPayload = ExamWithClassFormPayload & {
  answerKey: {
    version: string;
    fileBase64: string;
  };
};

export function ExamsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
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
  const [answerKeyFileName, setAnswerKeyFileName] = useState("");
  const [answerKeyFileBase64, setAnswerKeyFileBase64] = useState("");
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
  const publishedExamCount = rows.filter((exam) => exam.status === "PUBLISHED").length;
  const draftExamCount = rows.filter((exam) => exam.status === "DRAFT").length;
  const answerKeyReadyCount = rows.filter((exam) => exam.answerKeySummary?.status && exam.answerKeySummary.status !== "MISSING").length;
  const selectedParticipantClassCount = countParticipantClasses(participants, studentById);
  const selectedAttendedCount = participants.filter((participant) => participant.status === "ATTENDED").length;
  const selectedAbsentCount = participants.filter((participant) => participant.status === "ABSENT").length;
  const selectedRegisteredCount = participants.filter((participant) => participant.status === "REGISTERED").length;
  const selectedBookletSummary = formatBookletSummary(participants);
  const examSummaryItems: OperationSummaryItem[] = [
    {
      description: "Bu kurum kapsamındaki deneme sınavı",
      key: "total",
      label: "Sınav toplamı",
      value: formatCount(rows.length),
    },
    {
      description: "Rapor zincirine açık sınav",
      key: "published",
      label: "Yayında",
      tone: publishedExamCount > 0 ? "success" : "warning",
      value: formatCount(publishedExamCount),
    },
    {
      description: "Yayın veya katılımcı hazırlığı bekleyen sınav",
      key: "draft",
      label: "Taslak",
      tone: draftExamCount > 0 ? "warning" : "default",
      value: formatCount(draftExamCount),
    },
    {
      description: "Cevap anahtarı içe aktarılmış sınav",
      key: "answer-key-ready",
      label: "Cevap anahtarı",
      tone: answerKeyReadyCount === rows.length && rows.length > 0 ? "success" : "warning",
      value: `${formatCount(answerKeyReadyCount)}/${formatCount(rows.length)}`,
    },
    {
      description: selectedExam ? "Seçili sınav katılımcı kapsamı" : "Seçili sınav yok",
      key: "participants",
      label: "Seçili katılımcı",
      tone: participants.length > 0 ? "info" : "warning",
      value: formatCount(participants.length),
    },
  ];
  const examSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "active-exam",
      label: selectedExam ? `Aktif sınav: ${selectedExam.title}` : "Aktif sınav yok",
      tone: selectedExam ? examStatusTone(selectedExam.status) : "neutral",
    },
    {
      key: "participant-status",
      label: `Katılım: ${formatCount(selectedAttendedCount)} katıldı / ${formatCount(selectedAbsentCount)} gelmedi`,
      tone: selectedAttendedCount > 0 ? "success" : "neutral",
    },
    {
      key: "answer-key-status",
      label: `Cevap anahtarı: ${answerKeySummaryLabel(selectedExam?.answerKeySummary)}`,
      tone: answerKeyReady(selectedExam) ? "success" : "warning",
    },
    {
      key: "class-scope",
      label: `${formatCount(selectedParticipantClassCount)} sınıf kapsamı`,
      tone: selectedParticipantClassCount > 0 ? "info" : "neutral",
    },
  ];
  const studentCountByClassId = countStudentsByClassId(students);
  const normalizedClassSearch = classSearch.trim().toLocaleLowerCase("tr-TR");
  const visibleClasses = normalizedClassSearch
    ? classes.filter((klass) => classSearchText(klass).toLocaleLowerCase("tr-TR").includes(normalizedClassSearch))
    : classes;
  const selectedClassCount = form.classIds.length;
  const selectedStudentCount = form.classIds.reduce((total, classId) => total + (studentCountByClassId.get(classId) ?? 0), 0);
  const participantsNotFound = participantsQuery.error instanceof ApiRequestError && participantsQuery.error.status === 404;
  const examColumns: Array<DataTableColumn<ExamRecord>> = [
    {
      header: "Sınav",
      key: "title",
      priority: "primary",
      render: (exam) => exam.title,
      sticky: "left",
    },
    {
      header: "Durum",
      key: "status",
      priority: "secondary",
      render: (exam) => <StatusBadge tone={examStatusTone(exam.status)}>{examStatusLabel(exam.status)}</StatusBadge>,
    },
    {
      header: "Başlangıç",
      key: "startsAt",
      priority: "secondary",
      render: (exam) => formatDateTime(exam.startsAt),
    },
    {
      header: "Cevap anahtarı",
      key: "answerKey",
      priority: "secondary",
      render: (exam) => (
        <StatusBadge tone={answerKeyReady(exam) ? "success" : "warning"}>
          {answerKeySummaryLabel(exam.answerKeySummary)}
        </StatusBadge>
      ),
    },
    {
      align: "right",
      header: "İşlem",
      key: "actions",
      priority: "primary",
      render: (exam) => (
        <div className="next-row-actions">
          <button
            type="button"
            aria-pressed={activeExamId === exam.id}
            data-active={activeExamId === exam.id ? "true" : undefined}
            onClick={() => setSelectedExamId(exam.id)}
            aria-label={`${exam.title} katılımcıları`}
          >
            <Users size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void openEditForm(exam)} aria-label={`${exam.title} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          {exam.status === "DRAFT" ? (
            <button
              type="button"
              disabled={!answerKeyReady(exam)}
              onClick={() => void handlePublish(exam)}
              aria-label={answerKeyReady(exam) ? `${exam.title} yayınla` : `${exam.title} cevap anahtarı olmadan yayınlanamaz`}
              title={answerKeyReady(exam) ? "Yayınla" : "Cevap anahtarı olmadan yayınlanamaz"}
            >
              <CheckCircle2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" onClick={() => void handleDelete(exam)} aria-label={`${exam.title} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      ),
      sticky: "right",
    },
  ];
  const participantColumns: Array<DataTableColumn<ExamParticipantRecord>> = [
    {
      header: "Öğrenci",
      key: "student",
      priority: "primary",
      render: (participant) => studentName(studentById.get(participant.studentId)),
      sticky: "left",
    },
    {
      header: "Öğrenci no",
      key: "studentNo",
      priority: "optional",
      render: (participant) => studentById.get(participant.studentId)?.studentNo ?? "-",
    },
    {
      header: "Sınıf",
      key: "class",
      priority: "secondary",
      render: (participant) => classLabel(studentById.get(participant.studentId)?.classId, classById),
    },
    {
      header: "Katılım no",
      key: "participantNo",
      priority: "secondary",
      render: (participant) => participant.participantNo ?? "-",
    },
    {
      header: "Kitapçık",
      key: "booklet",
      priority: "optional",
      render: (participant) => participant.bookletType ?? "-",
    },
    {
      header: "Durum",
      key: "status",
      priority: "secondary",
      render: (participant) => (
        <StatusBadge tone={participantStatusTone(participant.status)}>{participantStatusLabel(participant.status)}</StatusBadge>
      ),
    },
  ];

  useEffect(() => {
    if (!participantsNotFound || !auth) return;

    setSelectedExamId("");
    void queryClient.invalidateQueries({ queryKey: ["next-exams", auth.session.tenantId] });
  }, [auth, participantsNotFound, queryClient]);

  function openCreateForm() {
    setForm(emptyForm);
    setEditingExam(null);
    setClassSearch("");
    setAnswerKeyFileName("");
    setAnswerKeyFileBase64("");
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
    setAnswerKeyFileName("");
    setAnswerKeyFileBase64("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setForm(emptyForm);
    setEditingExam(null);
    setClassSearch("");
    setAnswerKeyFileName("");
    setAnswerKeyFileBase64("");
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
    if (!editingExam && !answerKeyFileBase64) {
      setError("Cevap anahtarı dosyası zorunludur.");
      return;
    }

    try {
      const savedExam = editingExam
        ? await updateExam(auth.accessToken, editingExam.id, parsedForm.data)
        : await createExam(auth.accessToken, {
            ...parsedForm.data,
            answerKey: {
              version: createAnswerKeyVersion(parsedForm.data.title),
              fileBase64: answerKeyFileBase64,
            },
          });
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

  async function changeAnswerKeyFile(file: File | undefined) {
    setError("");
    setAnswerKeyFileName(file?.name ?? "");
    setAnswerKeyFileBase64(file ? await readFileAsBase64(file) : "");
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
    const confirmed = await confirm({
      confirmLabel: "Sil",
      description: "Bu işlem optik, sonuç ve rapor kayıtlarını da etkiler.",
      message: `${exam.title} sınavı silinsin mi?`,
      title: "Sınavı sil",
    });
    if (!confirmed) return;

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
      <OperationSummary ariaLabel="Sınav operasyon özeti" badges={examSummaryBadges} items={examSummaryItems} />
      <Panel
        aria-label="Sınav yönetimi"
        description="Deneme sınavlarının yayın durumu, başlangıç zamanı ve katılımcı hazırlığı."
        title="Sınav yönetimi"
      >
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        <DataTable
          caption="Sınav yönetimi"
          columns={examColumns}
          description="Deneme sınavlarının yayın durumu, başlangıç zamanı ve katılımcı hazırlığı."
          emptyText={
            <EmptyState
              title="Henüz sınav yok"
              description="İlk deneme sınavını ekleyerek katılımcı ve rapor hazırlığını başlat."
              primaryAction={{ label: "Sınav ekle", onClick: openCreateForm }}
            />
          }
          error={examsQuery.isError ? apiErrorMessage(examsQuery.error, "Sınavlar alınamadı.") : undefined}
          getRowKey={(exam) => exam.id}
          loading={examsQuery.isPending}
          rows={rows}
        />
      </Panel>
      {selectedExam ? (
        <Panel
          aria-label="Sınav katılımcıları"
          className="next-exam-selected-panel"
          description="Katılımcılar sınav oluşturulurken seçilen sınıftan otomatik eklenir."
          title={`${selectedExam.title} katılımcıları`}
        >
          <section className="next-exam-selected-context" aria-label="Sınav seçili detay">
            <div className="next-exam-selected-badges" aria-label="Seçili sınav durumu">
              <StatusBadge tone={examStatusTone(selectedExam.status)}>{examStatusLabel(selectedExam.status)}</StatusBadge>
              <StatusBadge tone={participants.length > 0 ? "success" : "warning"}>
                {participants.length > 0 ? "Katılım listesi hazır" : "Katılımcı bekleniyor"}
              </StatusBadge>
              <StatusBadge tone={selectedExam.status === "PUBLISHED" ? "info" : "neutral"}>
                {selectedExam.status === "PUBLISHED" ? "Rapor zinciri açık" : "Rapor için yayın bekliyor"}
              </StatusBadge>
            </div>
            <InfoGrid className="next-exam-selected-meta" aria-label="Seçili sınav metrikleri" role="region">
              <InfoItem label="Başlangıç" value={formatDateTime(selectedExam.startsAt)} />
              <InfoItem label="Katılımcı" value={`${formatCount(participants.length)} öğrenci`} />
              <InfoItem label="Katılan" value={`${formatCount(selectedAttendedCount)}/${formatCount(participants.length)}`} />
              <InfoItem label="Kitapçık" value={selectedBookletSummary} />
            </InfoGrid>
            <section className="next-exam-readiness" aria-label="Sınav hazırlık durumu">
              <span>{formatCount(selectedRegisteredCount)} kayıtlı katılımcı</span>
              <span>{formatCount(selectedAbsentCount)} gelmeyen katılımcı</span>
              <span>{formatCount(selectedParticipantClassCount)} sınıf kapsamı</span>
            </section>
            <DataTable
              caption={`${selectedExam.title} katılımcıları`}
              columns={participantColumns}
              density="compact"
              description="Sınıf seçiminden gelen öğrenci kapsamı, katılım no, kitapçık ve sınav katılım durumu."
              emptyText={<EmptyState title="Katılımcı yok" description="Bu sınav oluşturulurken seçilen sınıfta öğrenci bulunamadı." />}
              error={
                referencesQuery.isError || participantsQuery.isError
                  ? participantsNotFound
                    ? "Seçili sınav bulunamadı. Liste yenileniyor."
                    : "Katılımcı verisi alınamadı."
                  : undefined
              }
              getRowKey={(participant) => participant.id}
              loading={participantsQuery.isPending}
              rows={participants}
            />
          </section>
        </Panel>
      ) : null}
      <FormModal
        description="Sınav adı zorunludur. Başlangıç tarihi isteğe bağlıdır."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingExam ? "Kaydet" : "Ekle"}
        title={editingExam ? "Sınav düzenle" : "Sınav ekle"}
      >
        <Field label="Sınav adı" description="Rapor, optik import ve karne çıktılarında görünecek sınav adı.">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Başlangıç" description="Sınav başlangıcı rapor ve katılım hazırlığında tarih bağlamı sağlar.">
          <Input
            type="datetime-local"
            value={form.startsAt ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </Field>
        {!editingExam ? (
          <Field label="Cevap anahtarı dosyası" description="Excel dosyası; soru cevapları, branş, kazanım ve B kitapçık karşılığı içermelidir.">
            <Input
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              type="file"
              onChange={(event) => void changeAnswerKeyFile(event.target.files?.[0])}
            />
            {answerKeyFileName ? <p className="next-field-help">{answerKeyFileName}</p> : null}
          </Field>
        ) : null}
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
                <Checkbox
                  className="next-checkbox-option"
                  checked={checked}
                  description={[meta, `${studentCount} öğrenci`].filter(Boolean).join(" / ")}
                  key={klass.id}
                  label={klass.name}
                  name="classIds"
                  onChange={(event) => toggleClassSelection(klass.id, event.target.checked)}
                  value={klass.id}
                />
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
      {confirmationDialog}
    </PageFrame>
  );
}

async function loadExams(accessToken: string) {
  return apiRequest<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
}

async function createExam(accessToken: string, input: CreateExamPayload) {
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

function examStatusTone(status: string): StatusBadgeProps["tone"] {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

function answerKeyReady(exam: ExamRecord | undefined) {
  return Boolean(exam?.answerKeySummary?.status && exam.answerKeySummary.status !== "MISSING");
}

function answerKeySummaryLabel(summary: ExamRecord["answerKeySummary"] | undefined) {
  if (!summary || summary.status === "MISSING") return "Eksik";
  const questionCount = summary.questionCount ? `${formatCount(summary.questionCount)} soru` : "Hazır";
  if (summary.status === "PUBLISHED") return `Yayında / ${questionCount}`;
  return `Hazır / ${questionCount}`;
}

function formatDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

function studentName(student: StudentRecord | undefined) {
  return student ? `${student.firstName} ${student.lastName}` : "Öğrenci kapsamı doğrulanmadı";
}

function classLabel(classId: string | undefined, classById: Map<string, ClassRecord>) {
  if (!classId) return "Sınıf kapsamı doğrulanmadı";
  return classById.get(classId)?.name ?? "Sınıf kapsamı doğrulanmadı";
}

function participantStatusLabel(status: string) {
  if (status === "REGISTERED") return "Kayıtlı";
  if (status === "ATTENDED") return "Katıldı";
  if (status === "ABSENT") return "Gelmedi";
  return status;
}

function participantStatusTone(status: string): StatusBadgeProps["tone"] {
  if (status === "ATTENDED") return "success";
  if (status === "ABSENT") return "danger";
  if (status === "REGISTERED") return "info";
  return "neutral";
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

function countParticipantClasses(participants: ExamParticipantRecord[], studentById: Map<string, StudentRecord>) {
  return new Set(
    participants
      .map((participant) => studentById.get(participant.studentId)?.classId)
      .filter((classId): classId is string => Boolean(classId)),
  ).size;
}

function formatBookletSummary(participants: ExamParticipantRecord[]) {
  const bookletTypes = [
    ...new Set(participants.map((participant) => participant.bookletType).filter((booklet): booklet is string => Boolean(booklet))),
  ];
  if (bookletTypes.length === 0) return "Kitapçık yok";
  return bookletTypes.sort((left, right) => left.localeCompare(right, "tr-TR")).join(" / ");
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function createAnswerKeyVersion(examTitle: string) {
  const date = new Date();
  return `${slugifyVersionPart(examTitle)}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function slugifyVersionPart(value: string) {
  return value
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "cevap-anahtari";
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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
