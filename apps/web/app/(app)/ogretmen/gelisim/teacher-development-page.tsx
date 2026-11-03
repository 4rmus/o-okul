"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  developmentMentorNoteMaxLength,
  type DevelopmentAssessmentCreateRequest,
  type DevelopmentAssessmentRecord,
  type DevelopmentAssessmentVisibility,
  type DevelopmentAuthoringScope,
  type DevelopmentCriterionRecord,
  type StudentRecord,
} from "@o-okul/shared-types";
import { Alert, Button, EmptyState, Field, Input, Panel, Select, StatusBadge, Textarea } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiRequest, withQueryParams } from "../../../../src/api-client.js";
import { formatDate } from "../../_shared/format.js";
import { AccessPanel, PortalFrame } from "../../portals/_shared/portal-shell.js";

interface DevelopmentForm {
  studentId: string;
  periodLabel: string;
  scores: Record<string, string>;
  visibility: DevelopmentAssessmentVisibility;
  mentorNote: string;
}

const emptyForm: DevelopmentForm = { studentId: "", periodLabel: "", scores: {}, visibility: "INTERNAL", mentorNote: "" };

const visibilityLabels: Record<DevelopmentAssessmentVisibility, string> = {
  INTERNAL: "Yalnız okul içi",
  GUARDIAN: "Veli ve öğrenci de görür",
};

// DEC-20261102-05: class teachers and guidance counselors write; records are never edited, a correction is a new record.
export function TeacherDevelopmentPage() {
  const { auth } = useAuth();
  const isTeacher = auth?.session.subjectType === "TEACHER";
  const accessToken = auth?.accessToken ?? "";
  const sessionKey = auth?.session.userId ?? "anonymous";
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DevelopmentForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  const scopeQuery = useQuery({
    queryKey: ["teacher-development-scope", sessionKey],
    queryFn: () => apiRequest<DevelopmentAuthoringScope>(accessToken, `${apiBaseUrl}/development/authoring-scope`),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const studentsQuery = useQuery({
    queryKey: ["teacher-development-students", sessionKey],
    queryFn: () => apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/students`),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const criteriaQuery = useQuery({
    queryKey: ["teacher-development-criteria", sessionKey],
    queryFn: () => apiRequest<DevelopmentCriterionRecord[]>(accessToken, `${apiBaseUrl}/development/criteria`),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ["teacher-development-history", sessionKey, form.studentId],
    queryFn: () => apiRequest<DevelopmentAssessmentRecord[]>(
      accessToken,
      withQueryParams(`${apiBaseUrl}/development/assessments`, { studentId: form.studentId }),
    ),
    enabled: Boolean(isTeacher && form.studentId),
    refetchOnWindowFocus: false,
  });

  const students = useMemo(() => {
    const writable = new Set(scopeQuery.data?.studentIds ?? []);
    return (studentsQuery.data ?? [])
      .filter((student) => writable.has(student.id))
      .sort((left, right) => studentName(left).localeCompare(studentName(right), "tr"));
  }, [scopeQuery.data, studentsQuery.data]);
  const criteria = useMemo(
    () => [...(criteriaQuery.data ?? [])].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "tr")),
    [criteriaQuery.data],
  );
  const criterionNames = useMemo(() => new Map(criteria.map((criterion) => [criterion.id, criterion])), [criteria]);

  if (!isTeacher) return <AccessPanel title="Öğretmen Portalı" />;

  const loading = scopeQuery.isPending || studentsQuery.isPending || criteriaQuery.isPending;
  const loadFailed = scopeQuery.isError || studentsQuery.isError || criteriaQuery.isError;
  const noteLength = form.mentorNote.trim().length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scores = criteria
      .filter((criterion) => form.scores[criterion.id])
      .map((criterion) => ({ criterionId: criterion.id, score: Number(form.scores[criterion.id]) }));
    if (!form.studentId || !form.periodLabel.trim()) {
      setMessage({ tone: "alert", text: "Öğrenci ve dönem zorunludur." });
      return;
    }
    if (scores.length === 0) {
      setMessage({ tone: "alert", text: "En az bir kriter için puan seçin." });
      return;
    }
    if (noteLength > developmentMentorNoteMaxLength) {
      setMessage({ tone: "alert", text: `Mentör notu en fazla ${developmentMentorNoteMaxLength} karakter olabilir.` });
      return;
    }
    const body: DevelopmentAssessmentCreateRequest = {
      studentId: form.studentId,
      periodLabel: form.periodLabel.trim(),
      scores,
      visibility: form.visibility,
      ...(form.mentorNote.trim() ? { mentorNote: form.mentorNote.trim() } : {}),
    };
    setBusy(true);
    try {
      await apiRequest<DevelopmentAssessmentRecord>(accessToken, `${apiBaseUrl}/development/assessments`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setForm({ ...emptyForm, studentId: form.studentId, periodLabel: form.periodLabel });
      setMessage({ tone: "status", text: "Değerlendirme kaydedildi. Kayıt sonradan değiştirilemez; düzeltme için yeni değerlendirme ekleyin." });
      await queryClient.invalidateQueries({ queryKey: ["teacher-development-history", sessionKey, form.studentId] });
    } catch (error) {
      setMessage({
        tone: "alert",
        text: error instanceof ApiRequestError && error.status === 403
          ? "Bu öğrenci için değerlendirme yazamazsınız. Yalnız sınıf öğretmeni ve rehber öğretmen yazar."
          : "Değerlendirme kaydedilemedi. Bilgileri kontrol edip tekrar deneyin.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalFrame title="Öğretmen Portalı" subtitle="Sınıf öğretmeni veya rehber öğretmen olduğunuz öğrencilerin gelişim değerlendirmeleri">
      <Panel
        aria-label="Gelişim değerlendirmesi yaz"
        description="Kriterlere puan verin, görünürlüğü seçin ve kısa bir mentör notu ekleyin. Kaydedilen değerlendirme değiştirilemez."
        title="Gelişim değerlendirmesi"
      >
        {loading ? <p className="next-status-note" role="status">Yükleniyor…</p> : null}
        {!loading && loadFailed ? (
          <div className="next-form-actions">
            <p className="next-form-error" role="alert">Değerlendirme bilgileri alınamadı.</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void scopeQuery.refetch();
                void studentsQuery.refetch();
                void criteriaQuery.refetch();
              }}
            >
              Tekrar dene
            </Button>
          </div>
        ) : null}
        {!loading && !loadFailed && students.length === 0 ? (
          <EmptyState
            title="Değerlendirme yazabileceğiniz öğrenci yok"
            description="Gelişim değerlendirmesini sınıf öğretmeni ve rehber öğretmen yazar. Atama için kurum yöneticinizle görüşün."
          />
        ) : null}
        {!loading && !loadFailed && students.length > 0 && criteria.length === 0 ? (
          <EmptyState
            title="Gelişim kriteri tanımlı değil"
            description="Kurum yöneticisi gelişim kriterlerini ekledikten sonra değerlendirme yazabilirsiniz."
          />
        ) : null}
        {!loading && !loadFailed && students.length > 0 && criteria.length > 0 ? (
          <form aria-label="Gelişim değerlendirmesi formu" className="next-form" onSubmit={(event) => void submit(event)}>
            <Field label="Öğrenci">
              <Select
                value={form.studentId}
                onChange={(event) => {
                  setForm({ ...form, studentId: event.target.value });
                  setMessage(null);
                }}
              >
                <option value="">Seçin</option>
                {students.map((student) => <option key={student.id} value={student.id}>{studentName(student)}</option>)}
              </Select>
            </Field>
            <Field label="Dönem" description="Örnek: 2026 Kasım veya 1. dönem sonu">
              <Input maxLength={120} value={form.periodLabel} onChange={(event) => setForm({ ...form, periodLabel: event.target.value })} />
            </Field>
            <div aria-labelledby="development-score-title" className="next-form-section" role="group">
              <p className="next-form-section-title" id="development-score-title">Kriter puanları</p>
              {criteria.map((criterion) => (
                <Field key={criterion.id} label={`${criterion.name} (${criterion.scaleMin}–${criterion.scaleMax})`}>
                  <Select
                    value={form.scores[criterion.id] ?? ""}
                    onChange={(event) => setForm({ ...form, scores: { ...form.scores, [criterion.id]: event.target.value } })}
                  >
                    <option value="">Puan verme</option>
                    {scaleValues(criterion).map((value) => <option key={value} value={String(value)}>{value}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <Field
              label="Görünürlük"
              description={form.visibility === "INTERNAL"
                ? "Yalnız siz, rehber öğretmen ve kurum yöneticileri görür."
                : "Veli ve öğrenci portalında da görünür."}
            >
              <Select
                value={form.visibility}
                onChange={(event) => setForm({ ...form, visibility: event.target.value as DevelopmentAssessmentVisibility })}
              >
                <option value="INTERNAL">{visibilityLabels.INTERNAL}</option>
                <option value="GUARDIAN">{visibilityLabels.GUARDIAN}</option>
              </Select>
            </Field>
            <Alert tone="warning">Sağlık veya diğer özel nitelikli kişisel verileri yazmayın.</Alert>
            <Field
              label="Mentör notu"
              description={`${noteLength}/${developmentMentorNoteMaxLength} karakter`}
              error={noteLength > developmentMentorNoteMaxLength ? `En fazla ${developmentMentorNoteMaxLength} karakter yazabilirsiniz.` : undefined}
            >
              <Textarea
                maxLength={developmentMentorNoteMaxLength}
                rows={4}
                value={form.mentorNote}
                onChange={(event) => setForm({ ...form, mentorNote: event.target.value })}
              />
            </Field>
            {message ? <p className={message.tone === "alert" ? "next-form-error" : "next-field-hint"} role={message.tone}>{message.text}</p> : null}
            <div className="next-form-actions">
              <Button disabled={busy} type="submit">Değerlendirmeyi kaydet</Button>
            </div>
          </form>
        ) : null}
      </Panel>
      {form.studentId ? (
        <Panel aria-label="Önceki gelişim değerlendirmeleri" title="Önceki değerlendirmeler">
          {historyQuery.isError ? <p className="next-form-error" role="alert">Önceki değerlendirmeler alınamadı.</p> : null}
          {historyQuery.isSuccess && historyQuery.data.length === 0 ? (
            <p className="next-status-note">Bu öğrenci için görebildiğiniz bir değerlendirme yok.</p>
          ) : null}
          {historyQuery.isSuccess && historyQuery.data.length > 0 ? (
            <div className="next-note-list">
              {historyQuery.data.map((assessment) => (
                <article className="next-development-assessment" key={assessment.id}>
                  <header className="next-development-assessment__header">
                    <strong>{assessment.periodLabel}</strong>
                    <StatusBadge tone={assessment.visibility === "GUARDIAN" ? "info" : "neutral"}>
                      {visibilityLabels[assessment.visibility]}
                    </StatusBadge>
                    <span className="next-field-hint">{formatDate(assessment.createdAt)}</span>
                  </header>
                  <p>
                    {orderScoresByCriteria(assessment.scores, criteria)
                      .map((score) => {
                        const criterion = criterionNames.get(score.criterionId);
                        return `${criterion?.name ?? "Kriter"}: ${score.score}/${criterion?.scaleMax ?? "-"}`;
                      })
                      .join(" · ")}
                  </p>
                  {assessment.mentorNote ? <p>{assessment.mentorNote}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}
    </PortalFrame>
  );
}

function studentName(student: Pick<StudentRecord, "firstName" | "lastName">) {
  return `${student.firstName} ${student.lastName}`;
}

/**
 * Scores in the same order as the form fields (criterion sortOrder, then name); the API returns them by id.
 * Scores of a criterion no longer listed keep their place after the known ones.
 */
function orderScoresByCriteria<T extends { criterionId: string }>(scores: readonly T[], orderedCriteria: readonly Pick<DevelopmentCriterionRecord, "id">[]): T[] {
  const position = new Map(orderedCriteria.map((criterion, index) => [criterion.id, index]));
  return scores
    .map((score, index) => ({ index, rank: position.get(score.criterionId) ?? orderedCriteria.length, score }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.score);
}

function scaleValues(criterion: Pick<DevelopmentCriterionRecord, "scaleMin" | "scaleMax">) {
  const values: number[] = [];
  for (let value = criterion.scaleMin; value <= criterion.scaleMax; value += 1) values.push(value);
  return values;
}
