"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Button, DataTable, EmptyState, Field, InfoGrid, InfoItem, Input, MetricCard, MetricGrid, Panel, Select, StatusBadge, TabButton, Tabs, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  AnswerChoice,
  AnswerKeyRecord,
  ExamParticipantRecord,
  ExamRecord,
  OpticalFormTemplateRecord,
  ParserConfigPreset,
  ParserConfigSuggestion,
  ReportSnapshotExportResult,
  ReportSnapshotRecord,
  StudentRecord,
} from "@uzman-hocam/shared-types";
import { CheckCircle2, Download, FileSpreadsheet, FileText, Play, RefreshCw, Upload, Wand2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { buildReportAnalysisRows, type ReportAnalysisRow } from "../../_shared/report-analysis.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import {
  answerKeyImportFormSchema,
  examFormSchema,
  firstFormError,
  parserConfigApprovalFormSchema,
  parserConfigSuggestionFormSchema,
  quarantineLookupFormSchema,
  quarantineResolveFormSchema,
  rawImportUploadFormSchema,
  type AnswerKeyImportFormPayload,
  type ParserConfigSuggestionFormPayload,
  type QuarantineLookupFormPayload,
  type RawImportUploadFormPayload,
} from "../../../../src/form-validation.js";

type OpticalTab = "format" | "answer-key" | "upload" | "quarantine";

interface ParserConfigSuggestionResult {
  examId: string;
  suggestion: ParserConfigSuggestion;
  status: "suggested";
}

interface SavedParserConfig {
  tenantId: string;
  examId: string;
  templateId?: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: ParserConfigSuggestion["fieldMapping"];
  status: "APPROVED";
}

interface AnswerKeyImportDryRunResult {
  dryRun: true;
  examId: string;
  version: string;
  questionCount: number;
  branches: Array<{ branch: string; questionCount: number }>;
  bookletVariants: Array<{ code: string; questionCount: number }>;
  wouldImport: boolean;
}

interface AnswerKeyImportResult {
  imported: true;
  answerKey: AnswerKeyRecord;
  bookletVariants: Array<{ code: string; questionCount: number }>;
}

interface ManualAnswerKeyDryRunResult {
  tenantId: string;
  examId: string;
  version: string;
  questionCount: number;
  branches: Array<{ branch: string; questionCount: number }>;
  bookletVariants: Array<{ code: string; questionCount: number }>;
  status: "DRY_RUN";
}

type ManualAnswerChoice = "" | AnswerChoice;

interface ManualAnswerKeyQuestion {
  questionNo: number;
  correctAnswer: ManualAnswerChoice;
  branch: string;
  outcomeCode: string;
  topic: string;
}

interface RawImportUploadResult {
  rawImport: {
    id: string;
    examId: string;
    fileName: string;
    sha256: string;
    parserConfigVersion: string;
  };
  parseJob: {
    queueName: string;
    jobId: string;
    status: string;
  };
  status: "uploaded";
}

interface RawImportParseSummary {
  tenantId: string;
  examId: string;
  rawImportId: string;
  matchedCount: number;
  quarantinedCount: number;
  totalRows: number;
  quarantineReasons: Array<{ reason: string; count: number }>;
}

interface RawImportEvaluationQueueResult {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  matchedCount: number;
  queuedCount: number;
  queueName: "exam-evaluation";
  jobs: Array<{ participantId: string; jobId: string; status: "queued" }>;
}

interface RawImportEvaluationStatus {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  matchedCount: number;
  evaluatedCount: number;
  pendingCount: number;
  status: "COMPLETED" | "RUNNING";
}

interface ImportQuarantineRecord {
  id: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: Record<string, unknown>;
  reason: string;
  status: string;
  resolvedStudentId?: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  evaluationJob?: {
    queueName: "exam-evaluation";
    jobId: string;
    status: "queued";
  };
}

interface ReportGenerationQueueResult {
  tenantId: string;
  examId: string;
  reportType: "EXAM_RESULT_SUMMARY";
  queueName: "report-generation";
  jobId: string;
  status: "queued";
}

const tabs: Array<{ id: OpticalTab; label: string }> = [
  { id: "format", label: "1. Format" },
  { id: "answer-key", label: "2. Cevap anahtarı" },
  { id: "upload", label: "3. Optik yükleme" },
  { id: "quarantine", label: "4. Eşleşmeyen satırlar" },
];

const answerChoices: AnswerChoice[] = ["A", "B", "C", "D", "E"];

interface OpticalFormPreviewRow {
  section: string;
  start: string;
  end: string;
}

const opticalFormPreviewColumns: Array<DataTableColumn<OpticalFormPreviewRow>> = [
  {
    header: "Bölüm",
    key: "section",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.section,
    sticky: "left",
  },
  {
    align: "right",
    header: "Başlangıç",
    key: "start",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.start,
  },
  {
    align: "right",
    header: "Bitiş",
    key: "end",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.end,
  },
];

const opticalFormPresets: Array<{
  preset: ParserConfigPreset;
  name: string;
  sourceType: string;
  rowLength: number;
  questionCount: number;
  rows: OpticalFormPreviewRow[];
}> = [
  {
    preset: "OPTIK_7108_LGS",
    name: "OPTİK FORM-7108",
    sourceType: "TXT/DAT",
    rowLength: 171,
    questionCount: 90,
    rows: [
      { section: "TC KİMLİK NO", start: "38", end: "48" },
      { section: "OKUL NO", start: "12", end: "15" },
      { section: "KİTAPÇIK TÜRÜ", start: "51", end: "51" },
      { section: "AD SOYAD", start: "16", end: "35" },
      { section: "TÜRKÇE", start: "52", end: "71" },
      { section: "SOSYAL BİLGİLER / T.C. İNKILAP TARİHİ", start: "72", end: "81" },
      { section: "DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", start: "92", end: "101" },
      { section: "İNGİLİZCE", start: "112", end: "121" },
      { section: "MATEMATİK", start: "132", end: "151" },
      { section: "FEN BİLİMLERİ", start: "152", end: "171" },
    ],
  },
];

type OpticalFormPreset = (typeof opticalFormPresets)[number];
const defaultParserConfigVersion = createPresetParserVersion(opticalFormPresets[0]!);

function createPresetParserVersion(form: OpticalFormPreset) {
  const slug = slugifyVersionPart(form.name);
  return `${slug}-v1`;
}

function createAnswerKeyVersion(examTitle: string | undefined, uploadedAt: Date) {
  return `${slugifyVersionPart(examTitle || "cevap-anahtari")}-${formatLocalDate(uploadedAt)}`;
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

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSelectedFileNotice(fileName: string) {
  const extension = fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  return extension ? `${extension} dosyası seçildi` : "Dosya seçildi";
}

function formatEvidenceSafeReference(value: string | undefined, label: string) {
  return value?.trim() ? `${label}: maskeli` : `${label}: yok`;
}

export function ParserConfigPage() {
  const { auth } = useAuth();
  const [activeTab, setActiveTab] = useState<OpticalTab>("format");
  const [examId, setExamId] = useState("");
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [newExamTitle, setNewExamTitle] = useState("");
  const [newExamStartsAt, setNewExamStartsAt] = useState("");
  const [version, setVersion] = useState(defaultParserConfigVersion);
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [suggestion, setSuggestion] = useState<ParserConfigSuggestion | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedParserConfig | null>(null);
  const [templates, setTemplates] = useState<OpticalFormTemplateRecord[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<ParserConfigPreset>("OPTIK_7108_LGS");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateVersion, setTemplateVersion] = useState("template-v1");
  const [templateApplyVersion, setTemplateApplyVersion] = useState(defaultParserConfigVersion);
  const [answerKeyFileName, setAnswerKeyFileName] = useState("");
  const [answerKeyFileBase64, setAnswerKeyFileBase64] = useState("");
  const [answerKeyUploadedAt, setAnswerKeyUploadedAt] = useState(() => new Date());
  const [answerKeyVersionTouched, setAnswerKeyVersionTouched] = useState(false);
  const [answerKeyVersion, setAnswerKeyVersion] = useState(() => createAnswerKeyVersion(undefined, new Date()));
  const [answerKeyDryRun, setAnswerKeyDryRun] = useState<AnswerKeyImportDryRunResult | null>(null);
  const [answerKeyImport, setAnswerKeyImport] = useState<AnswerKeyImportResult | null>(null);
  const [manualAnswerKeyVersion, setManualAnswerKeyVersion] = useState("manual-key-v1");
  const [manualAnswerText, setManualAnswerText] = useState("");
  const [manualBPermutationText, setManualBPermutationText] = useState("");
  const [manualQuestions, setManualQuestions] = useState<ManualAnswerKeyQuestion[]>(() => createManualAnswerKeyGrid());
  const [manualDryRun, setManualDryRun] = useState<ManualAnswerKeyDryRunResult | null>(null);
  const [manualAnswerKey, setManualAnswerKey] = useState<AnswerKeyRecord | null>(null);
  const [rawImportFileName, setRawImportFileName] = useState("");
  const [rawImportFileBase64, setRawImportFileBase64] = useState("");
  const [rawImportParserVersion, setRawImportParserVersion] = useState(defaultParserConfigVersion);
  const [rawImport, setRawImport] = useState<RawImportUploadResult | null>(null);
  const [rawImportSummary, setRawImportSummary] = useState<RawImportParseSummary | null>(null);
  const [evaluationJobs, setEvaluationJobs] = useState<RawImportEvaluationQueueResult | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<RawImportEvaluationStatus | null>(null);
  const [isRawImportSubmitting, setIsRawImportSubmitting] = useState(false);
  const [isRawImportChecking, setIsRawImportChecking] = useState(false);
  const [isEvaluationSubmitting, setIsEvaluationSubmitting] = useState(false);
  const [quarantineRawImportId, setQuarantineRawImportId] = useState("");
  const [quarantines, setQuarantines] = useState<ImportQuarantineRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentByQuarantine, setSelectedStudentByQuarantine] = useState<Record<string, string>>({});
  const [reportContentHash, setReportContentHash] = useState("");
  const [reportJob, setReportJob] = useState<ReportGenerationQueueResult | null>(null);
  const [reportParticipants, setReportParticipants] = useState<ExamParticipantRecord[]>([]);
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshotRecord[]>([]);
  const [isReportSubmitting, setIsReportSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectedExam = exams.find((exam) => exam.id === examId);
  const selectedPresetForm = opticalFormPresets.find((form) => form.preset === selectedPreset) ?? opticalFormPresets[0]!;
  const selectedPresetVersion = createPresetParserVersion(selectedPresetForm);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  useEffect(() => {
    if (!auth) return;
    const accessToken = auth.accessToken;

    async function loadInitialData() {
      try {
        const [examRecords, templateRecords] = await Promise.all([
          loadOpticalExams(accessToken),
          loadOpticalFormTemplates(accessToken),
        ]);
        setExams(examRecords);
        setTemplates(templateRecords);
        setExamId((current) => (current || examRecords[0]?.id) ?? "");
        setSelectedTemplateId((current) => (current || templateRecords[0]?.id) ?? "");
      } catch {
        setError("Sınav ve optik şablon listesi alınamadı.");
      }
    }

    void loadInitialData();
  }, [auth]);

  useEffect(() => {
    if (answerKeyVersionTouched) return;
    setAnswerKeyVersion(createAnswerKeyVersion(selectedExam?.title, answerKeyUploadedAt));
  }, [answerKeyUploadedAt, answerKeyVersionTouched, selectedExam?.title]);

  async function submitCreateExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    if (!newExamStartsAt.trim()) {
      setError("Başlangıç zorunludur.");
      return;
    }
    const parsedForm = examFormSchema.safeParse({ title: newExamTitle, startsAt: newExamStartsAt });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const created = await createOpticalExam(auth.accessToken, parsedForm.data);
      setExams((current) => [created, ...current.filter((exam) => exam.id !== created.id)]);
      setExamId(created.id);
      setNewExamTitle("");
      setNewExamStartsAt("");
    } catch (examError) {
      setError(apiErrorMessage(examError, "Sınav oluşturulamadı."));
    }
  }

  async function submitSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    setSavedConfig(null);
    const parsedSuggestionForm = parserConfigSuggestionFormSchema.safeParse({ examId, fileBase64 });
    const parsedApprovalForm = parserConfigApprovalFormSchema.safeParse({ examId, version });
    if (!parsedSuggestionForm.success) {
      setError(firstFormError(parsedSuggestionForm.error));
      return;
    }
    if (!parsedApprovalForm.success) {
      setError(firstFormError(parsedApprovalForm.error));
      return;
    }
    try {
      const selectedFileBase64 = parsedSuggestionForm.data.fileBase64;
      if (!selectedFileBase64) {
        setError("Dosya seçilmelidir.");
        return;
      }
      const result = await suggestParserConfig(auth.accessToken, parsedSuggestionForm.data.examId, { fileBase64: selectedFileBase64 });
      const approved = await approveParserConfig(auth.accessToken, result.examId, parsedApprovalForm.data.version, result.suggestion);
      setExamId(result.examId);
      setSuggestion(result.suggestion);
      setSavedConfig(approved);
      setVersion(approved.version);
      setRawImportParserVersion(approved.version);
      setTemplateApplyVersion(approved.version);
      setActiveTab("answer-key");
    } catch (suggestionError) {
      setError(apiErrorMessage(suggestionError, "Optik dosya formatı kaydedilemedi."));
    }
  }

  async function submitPresetSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    setSavedConfig(null);
    const normalizedExamId = examId.trim();
    if (!normalizedExamId) {
      setError("Sınav seçilmeli veya yeni sınav oluşturulmalıdır.");
      return;
    }
    try {
      const result = await suggestParserConfig(auth.accessToken, normalizedExamId, { preset: selectedPreset });
      const approved = await approveParserConfig(auth.accessToken, result.examId, selectedPresetVersion, result.suggestion);
      setExamId(result.examId);
      setSuggestion(result.suggestion);
      setSavedConfig(approved);
      setVersion(approved.version);
      setFileName("");
      setFileBase64("");
      setRawImportParserVersion(approved.version);
      setTemplateApplyVersion(approved.version);
      setActiveTab("answer-key");
    } catch (presetError) {
      setError(apiErrorMessage(presetError, "TXT/DAT form yapısı seçilemedi."));
    }
  }

  async function changeFile(file: File | undefined) {
    setError("");
    setSuggestion(null);
    setSavedConfig(null);

    if (!file) {
      setFileName("");
      setFileBase64("");
      return;
    }

    try {
      setFileName(file.name);
      setFileBase64(await readFileAsBase64(file));
    } catch {
      setFileName("");
      setFileBase64("");
      setError("Optik dosya okunamadı.");
    }
  }

  async function submitTemplateCreate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!auth || !suggestion) return;

    setError("");
    const name = templateName.trim();
    const templateVersionValue = templateVersion.trim();
    if (!name) {
      setError("Şablon adı zorunludur.");
      return;
    }
    if (!templateVersionValue) {
      setError("Şablon versiyonu zorunludur.");
      return;
    }
    try {
      const created = await createOpticalFormTemplate(auth.accessToken, {
        name,
        version: templateVersionValue,
        suggestion,
      });
      setTemplates((current) => [created, ...current.filter((template) => template.id !== created.id)]);
      setSelectedTemplateId(created.id);
      setTemplateName("");
    } catch (templateError) {
      setError(apiErrorMessage(templateError, "Optik form şablonu kaydedilemedi."));
    }
  }

  async function submitTemplateApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const templateId = selectedTemplateId.trim();
    const parserVersion = templateApplyVersion.trim();
    if (!examId.trim()) {
      setError("Sınav seçilmelidir.");
      return;
    }
    if (!templateId) {
      setError("Optik form şablonu seçilmelidir.");
      return;
    }
    if (!parserVersion) {
      setError("Format sürümü zorunludur.");
      return;
    }
    try {
      const applied = await applyOpticalFormTemplate(auth.accessToken, templateId, {
        examId,
        version: parserVersion,
      });
      setSavedConfig(applied);
      setVersion(applied.version);
      setRawImportParserVersion(applied.version);
    } catch (templateError) {
      setError(apiErrorMessage(templateError, "Optik form şablonu sınava uygulanamadı."));
    }
  }

  async function changeAnswerKeyFile(file: File | undefined) {
    setError("");
    setAnswerKeyDryRun(null);
    setAnswerKeyImport(null);
    setAnswerKeyFileName(file?.name ?? "");
    if (!file) {
      setAnswerKeyFileBase64("");
      return;
    }

    const uploadedAt = new Date();
    setAnswerKeyUploadedAt(uploadedAt);
    if (!answerKeyVersionTouched || !answerKeyVersion.trim()) {
      setAnswerKeyVersion(createAnswerKeyVersion(selectedExam?.title, uploadedAt));
    }
    setAnswerKeyFileBase64(await readFileAsBase64(file));
  }

  async function submitAnswerKeyDryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = answerKeyImportFormSchema.safeParse({ examId, version: answerKeyVersion, fileBase64: answerKeyFileBase64 });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      setAnswerKeyDryRun(await dryRunAnswerKeyImport(auth.accessToken, parsedForm.data));
      setAnswerKeyImport(null);
    } catch (dryRunError) {
      setError(apiErrorMessage(dryRunError, "Cevap anahtarı doğrulanamadı."));
    }
  }

  async function submitAnswerKeyImport() {
    if (!auth) return;

    setError("");
    const parsedForm = answerKeyImportFormSchema.safeParse({ examId, version: answerKeyVersion, fileBase64: answerKeyFileBase64 });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      setAnswerKeyImport(await importAnswerKey(auth.accessToken, parsedForm.data));
    } catch (importError) {
      setError(apiErrorMessage(importError, "Cevap anahtarı içe aktarılamadı."));
    }
  }

  function applyManualAnswerText() {
    const choices = manualAnswerText.toUpperCase().replace(/[^ABCDE]/g, "").split("") as AnswerChoice[];
    setManualQuestions((current) =>
      current.map((question, index) => ({
        ...question,
        correctAnswer: choices[index] ?? question.correctAnswer,
      })),
    );
  }

  function updateManualQuestion(questionNo: number, patch: Partial<ManualAnswerKeyQuestion>) {
    setManualDryRun(null);
    setManualAnswerKey(null);
    setManualQuestions((current) =>
      current.map((question) => (question.questionNo === questionNo ? { ...question, ...patch } : question)),
    );
  }

  async function submitManualAnswerKey(dryRun: boolean) {
    if (!auth) return;

    setError("");
    const missing = manualQuestions.find((question) => !question.correctAnswer || !question.branch.trim());
    if (missing) {
      setError(`${missing.questionNo}. soru için şık ve branş zorunludur.`);
      return;
    }
    const questions = manualQuestions.map((question) => ({
      questionNo: question.questionNo,
      correctAnswer: question.correctAnswer as AnswerChoice,
      branch: question.branch,
      ...(question.outcomeCode.trim() ? { outcomeCode: question.outcomeCode.trim() } : {}),
      ...(question.topic.trim() ? { topic: question.topic.trim() } : {}),
    }));
    let bookletVariants: Array<{ code: string; permutation: number[] }>;
    try {
      bookletVariants = parseManualBPermutation(manualBPermutationText, questions.length);
    } catch (error) {
      setError(error instanceof Error ? error.message : "B kitapçık sırası geçerli değildir.");
      return;
    }

    try {
      const result = await saveManualAnswerKey(auth.accessToken, {
        examId,
        version: manualAnswerKeyVersion,
        questions,
        bookletVariants,
        dryRun,
      });
      if (dryRun) {
        setManualDryRun(result as ManualAnswerKeyDryRunResult);
        setManualAnswerKey(null);
      } else {
        setManualAnswerKey(result as AnswerKeyRecord);
      }
    } catch (manualError) {
      setError(apiErrorMessage(manualError, dryRun ? "Manuel cevap anahtarı doğrulanamadı." : "Manuel cevap anahtarı kaydedilemedi."));
    }
  }

  async function changeRawImportFile(file: File | undefined) {
    setError("");
    setRawImport(null);
    setRawImportSummary(null);
    setEvaluationJobs(null);
    setEvaluationStatus(null);
    setQuarantines([]);
    setRawImportFileName(file?.name ?? "");
    setRawImportFileBase64(file ? await readFileAsBase64(file) : "");
  }

  async function submitRawImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = rawImportUploadFormSchema.safeParse({
      examId,
      parserConfigVersion: rawImportParserVersion,
      sourceType: "OPTICAL_ANSWER_TXT",
      fileName: rawImportFileName,
      fileBase64: rawImportFileBase64,
    });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    let result: RawImportUploadResult;
    setIsRawImportSubmitting(true);
    try {
      result = await uploadRawImport(auth.accessToken, parsedForm.data);
    } catch (uploadError) {
      setError(apiErrorMessage(uploadError, "Optik cevap dosyası yüklenemedi."));
      return;
    } finally {
      setIsRawImportSubmitting(false);
    }

    setRawImport(result);
    setRawImportSummary(null);
    setEvaluationJobs(null);
    setEvaluationStatus(null);
    setQuarantineRawImportId(result.rawImport.id);
    setQuarantines([]);
    setReportContentHash("");
    setReportJob(null);
    setIsReportSubmitting(false);

    setIsRawImportChecking(true);
    try {
      setRawImportSummary(await waitForRawImportSummary(auth.accessToken, examId, result.rawImport.id));
      const [records, studentRecords] = await Promise.all([
        loadQuarantines(auth.accessToken, { examId, rawImportId: result.rawImport.id }),
        loadStudents(auth.accessToken),
      ]);
      setQuarantines(records);
      setStudents(studentRecords);
    } catch (analysisError) {
      setError(apiErrorMessage(analysisError, "Optik analizi henüz tamamlanmadı. Özeti veya eşleşmeyen satırları yeniden getirin."));
    } finally {
      setIsRawImportChecking(false);
    }
  }

  async function refreshRawImportSummary() {
    if (!auth) return;

    setError("");
    const rawImportId = (rawImport?.rawImport.id ?? quarantineRawImportId).trim();
    if (!examId.trim() || !rawImportId) {
      setError("Sınav ve raw import ID zorunludur.");
      return;
    }
    setIsRawImportChecking(true);
    try {
      setRawImportSummary(await loadRawImportSummary(auth.accessToken, examId, rawImportId));
    } catch (summaryError) {
      setError(apiErrorMessage(summaryError, "Optik ön kontrol özeti alınamadı."));
    } finally {
      setIsRawImportChecking(false);
    }
  }

  async function submitEvaluationJobs() {
    if (!auth) return;

    setError("");
    const rawImportId = (rawImport?.rawImport.id ?? quarantineRawImportId).trim();
    if (!examId.trim() || !rawImportId) {
      setError("Sınav ve raw import ID zorunludur.");
      return;
    }
    if (!rawImportSummary) {
      setError("Önce yükleme özetinin tamamlanmasını bekleyin.");
      return;
    }
    setIsEvaluationSubmitting(true);
    try {
      const answerKeyId = answerKeyImport?.answerKey.id ?? manualAnswerKey?.id;
      const jobs = await enqueueRawImportEvaluation(auth.accessToken, {
        examId,
        rawImportId,
        answerKeyId,
      });
      setEvaluationJobs(jobs);
      const rawImportSha = jobs.rawImportSha256 ?? rawImport?.rawImport.sha256;
      if (rawImportSha && jobs.answerKeyId) {
        setReportContentHash(`${rawImportSha}-${jobs.answerKeyId}`);
      }
      const status = await waitForRawImportEvaluationStatus(auth.accessToken, {
        examId,
        rawImportId,
        answerKeyId: jobs.answerKeyId,
        expectedCount: jobs.queuedCount,
      });
      setEvaluationStatus(status);
      setActiveTab("quarantine");
    } catch (evaluationError) {
      setError(apiErrorMessage(evaluationError, "Analiz işleri kuyruğa alındı ancak tamamlanma sonucu alınamadı. Birazdan tekrar deneyin."));
    } finally {
      setIsEvaluationSubmitting(false);
    }
  }

  async function submitQuarantineLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = quarantineLookupFormSchema.safeParse({ examId, rawImportId: quarantineRawImportId });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const [records, studentRecords] = await Promise.all([
        loadQuarantines(auth.accessToken, parsedForm.data),
        loadStudents(auth.accessToken),
      ]);
      setQuarantines(records);
      setStudents(studentRecords);
    } catch (lookupError) {
      setError(apiErrorMessage(lookupError, "Karantina kayıtları alınamadı."));
    }
  }

  async function resolveQuarantine(record: ImportQuarantineRecord) {
    if (!auth) return;

    setError("");
    const parsedForm = quarantineResolveFormSchema.safeParse({ resolvedStudentId: selectedStudentByQuarantine[record.id] ?? "" });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const resolved = await resolveImportQuarantine(auth.accessToken, {
        examId: record.examId,
        rawImportId: record.rawImportId,
        quarantineId: record.id,
        resolvedStudentId: parsedForm.data.resolvedStudentId,
      });
      setQuarantines((current) => current.map((item) => (item.id === resolved.id ? resolved : item)));
      if (resolved.rawImportSha256 && resolved.answerKeyId) {
        setReportContentHash(`${resolved.rawImportSha256}-${resolved.answerKeyId}`);
      }
    } catch (resolveError) {
      setError(apiErrorMessage(resolveError, "Karantina kaydı çözülemedi."));
    }
  }

  async function submitReportGeneration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const normalizedExamId = examId.trim();
    const normalizedContentHash = reportContentHash.trim();
    if (!normalizedExamId) {
      setError("Sınav seçilmelidir.");
      return;
    }
    if (!normalizedContentHash) {
      setError("Rapor üretmeden önce eşleşen satırlar için analizi başlatın.");
      return;
    }
    if (evaluationStatus?.status !== "COMPLETED" || evaluationStatus.evaluatedCount <= 0) {
      setError("Rapor üretmeden önce analiz tamamlanmalıdır.");
      return;
    }
    setIsReportSubmitting(true);
    try {
      const currentReadyCount = countReadyReportSnapshots(reportSnapshots);
      setReportJob(await enqueueReportGeneration(auth.accessToken, normalizedExamId, normalizedContentHash));
      const [snapshots, context] = await Promise.all([
        waitForReportSnapshots(auth.accessToken, normalizedExamId, currentReadyCount),
        loadReportTableContext(auth.accessToken, normalizedExamId),
      ]);
      setReportSnapshots(snapshots);
      setReportParticipants(context.participants);
      setStudents(context.students);
    } catch (reportError) {
      setError(apiErrorMessage(reportError, "Rapor üretimi kuyruğa alınamadı."));
    } finally {
      setIsReportSubmitting(false);
    }
  }

  async function refreshReportSnapshots() {
    if (!auth) return;

    setError("");
    const normalizedExamId = examId.trim();
    if (!normalizedExamId) {
      setError("Sınav seçilmelidir.");
      return;
    }
    try {
      const [snapshots, context] = await Promise.all([
        loadReportSnapshots(auth.accessToken, normalizedExamId),
        loadReportTableContext(auth.accessToken, normalizedExamId),
      ]);
      setReportSnapshots(snapshots);
      setReportParticipants(context.participants);
      setStudents(context.students);
    } catch (snapshotError) {
      setError(apiErrorMessage(snapshotError, "Rapor listesi alınamadı."));
    }
  }

  async function downloadReportSnapshot(snapshot: ReportSnapshotRecord, format: "xlsx" | "pdf") {
    if (!auth) return;

    setError("");
    try {
      const result = await exportReportSnapshot(auth.accessToken, snapshot.examId, snapshot.id, format);
      downloadBase64File(result);
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, "Rapor indirilemedi."));
    }
  }

  return (
    <PageFrame
      title="Optik İşlemleri"
      subtitle="Sınavı seç, optik formatı kaydet, cevap anahtarını hazırla ve yüklenen satırları tek akışta kontrol et."
    >
      <OpticalExamSelector
        examId={examId}
        exams={exams}
        newExamStartsAt={newExamStartsAt}
        newExamTitle={newExamTitle}
        selectedExam={selectedExam}
        onExamChange={(value) => {
          setExamId(value);
          setReportSnapshots([]);
          setReportParticipants([]);
          setReportJob(null);
          setSuggestion(null);
          setSavedConfig(null);
        }}
        onNewExamStartsAtChange={setNewExamStartsAt}
        onNewExamTitleChange={setNewExamTitle}
        onSubmit={submitCreateExam}
      />
      <Panel
        aria-label="Optik operasyon"
        className="next-optical-workspace"
        description="Sınav formatı, cevap anahtarı, optik yükleme, eşleşmeyen satır çözümü ve rapor üretimi aynı görev yüzeyinde ilerler."
        title="Optik Operasyon Akışı"
      >
        <Tabs label="Optik sekmeleri" className="next-optical-tabs">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              aria-controls={activeTab === tab.id ? `optical-panel-${tab.id}` : undefined}
              id={`optical-tab-${tab.id}`}
              selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
        </Tabs>
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        <div
          aria-labelledby={`optical-tab-${activeTab}`}
          className="next-optical-tab-panel"
          id={`optical-panel-${activeTab}`}
          role="tabpanel"
          tabIndex={0}
        >
        {activeTab === "format" ? (
          <OpticalFormatSetup
            examId={examId}
            fileName={fileName}
            savedConfig={savedConfig}
            selectedPreset={selectedPreset}
            selectedPresetForm={selectedPresetForm}
            selectedPresetVersion={selectedPresetVersion}
            selectedTemplate={selectedTemplate}
            selectedTemplateId={selectedTemplateId}
            suggestion={suggestion}
            templateApplyVersion={templateApplyVersion}
            templateName={templateName}
            templateVersion={templateVersion}
            templates={templates}
            version={version}
            onFileChange={changeFile}
            onPresetChange={(value) => {
              const nextForm = opticalFormPresets.find((form) => form.preset === value) ?? opticalFormPresets[0]!;
              setSelectedPreset(value);
              setVersion(createPresetParserVersion(nextForm));
              setTemplateApplyVersion(createPresetParserVersion(nextForm));
              setSuggestion(null);
              setSavedConfig(null);
            }}
            onPresetSubmit={submitPresetSuggestion}
            onSuggestionSubmit={submitSuggestion}
            onTemplateApplySubmit={submitTemplateApply}
            onTemplateApplyVersionChange={setTemplateApplyVersion}
            onTemplateCreate={submitTemplateCreate}
            onTemplateIdChange={setSelectedTemplateId}
            onTemplateNameChange={setTemplateName}
            onTemplateVersionChange={setTemplateVersion}
            onVersionChange={setVersion}
          />
        ) : null}
        {activeTab === "answer-key" ? (
          <AnswerKeySetup
            answerKeyDryRun={answerKeyDryRun}
            answerKeyFileName={answerKeyFileName}
            answerKeyImport={answerKeyImport}
            answerKeyVersion={answerKeyVersion}
            manualAnswerKey={manualAnswerKey}
            manualAnswerKeyVersion={manualAnswerKeyVersion}
            manualAnswerText={manualAnswerText}
            manualBPermutationText={manualBPermutationText}
            manualDryRun={manualDryRun}
            manualQuestions={manualQuestions}
            onAnswerKeyDryRunSubmit={submitAnswerKeyDryRun}
            onAnswerKeyFileChange={changeAnswerKeyFile}
            onAnswerKeyImport={submitAnswerKeyImport}
            onAnswerKeyVersionChange={(value) => {
              setAnswerKeyVersionTouched(true);
              setAnswerKeyVersion(value);
            }}
            onManualAnswerKeyVersionChange={setManualAnswerKeyVersion}
            onManualAnswerTextApply={applyManualAnswerText}
            onManualAnswerTextChange={setManualAnswerText}
            onManualBPermutationTextChange={setManualBPermutationText}
            onManualQuestionChange={updateManualQuestion}
            onManualSave={submitManualAnswerKey}
          />
        ) : null}
        {activeTab === "upload" ? (
          <OpticalUploadPanel
            evaluationJobs={evaluationJobs}
            evaluationStatus={evaluationStatus}
            isEvaluationSubmitting={isEvaluationSubmitting}
            isRawImportChecking={isRawImportChecking}
            isRawImportSubmitting={isRawImportSubmitting}
            rawImport={rawImport}
            rawImportFileName={rawImportFileName}
            rawImportParserVersion={rawImportParserVersion}
            rawImportSummary={rawImportSummary}
            onEvaluationStart={submitEvaluationJobs}
            onFileChange={changeRawImportFile}
            onParserVersionChange={setRawImportParserVersion}
            onRefreshSummary={refreshRawImportSummary}
            onSubmit={submitRawImport}
          />
        ) : null}
        {activeTab === "quarantine" ? (
          <section className="next-optical-report-workspace" aria-label="Eşleşmeyen satırlar ve rapor">
            <QuarantineResolutionPanel
              quarantineRawImportId={quarantineRawImportId}
              quarantines={quarantines}
              selectedStudentByQuarantine={selectedStudentByQuarantine}
              students={students}
              onLookupSubmit={submitQuarantineLookup}
              onQuarantineRawImportIdChange={setQuarantineRawImportId}
              onResolve={resolveQuarantine}
              onSelectedStudentChange={setSelectedStudentByQuarantine}
            />
            <OpticalReportPanel
              evaluationStatus={evaluationStatus}
              isReportSubmitting={isReportSubmitting}
              participants={reportParticipants}
              reportContentHash={reportContentHash}
              reportJob={reportJob}
              reportSnapshots={reportSnapshots}
              students={students}
              onDownload={downloadReportSnapshot}
              onRefreshSnapshots={refreshReportSnapshots}
              onSubmit={submitReportGeneration}
            />
          </section>
        ) : null}
        </div>
      </Panel>
    </PageFrame>
  );
}

interface OpticalExamSelectorProps {
  examId: string;
  exams: ExamRecord[];
  newExamStartsAt: string;
  newExamTitle: string;
  selectedExam?: ExamRecord;
  onExamChange: (value: string) => void;
  onNewExamStartsAtChange: (value: string) => void;
  onNewExamTitleChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function OpticalExamSelector({
  examId,
  exams,
  newExamStartsAt,
  newExamTitle,
  selectedExam,
  onExamChange,
  onNewExamStartsAtChange,
  onNewExamTitleChange,
  onSubmit,
}: OpticalExamSelectorProps) {
  const showCreateExamFields = !selectedExam;

  return (
    <section className="next-optical-selector-grid" aria-label="Sınav seçimi">
      <Panel
        as="form"
        aria-label="Sınav seç veya oluştur"
        className="next-optical-selector-panel"
        description="Optik iş akışını mevcut sınava bağla veya yeni sınav kaydı oluştur."
        title="Sınav seç veya oluştur"
        onSubmit={(event) => void onSubmit(event)}
      >
        <Field label="Sınav seç">
          <Select value={examId} onChange={(event) => onExamChange(event.target.value)}>
            <option value="">Yeni sınav oluştur</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </Select>
        </Field>
        {selectedExam ? <p>{`Seçili sınav: ${selectedExam.title}`}</p> : null}
        {showCreateExamFields ? (
          <>
            <p>Yeni sınav için ad ve başlangıç tarihi gir.</p>
            <Field label="Yeni sınav adı">
              <Input required value={newExamTitle} onChange={(event) => onNewExamTitleChange(event.target.value)} />
            </Field>
            <Field label="Başlangıç">
              <Input
                required
                type="datetime-local"
                value={newExamStartsAt}
                onChange={(event) => onNewExamStartsAtChange(event.target.value)}
              />
            </Field>
            <Button type="submit">
              <CheckCircle2 size={17} aria-hidden="true" />
              Sınav oluştur
            </Button>
          </>
        ) : null}
      </Panel>
    </section>
  );
}

interface OpticalFormatSetupProps {
  examId: string;
  fileName: string;
  savedConfig: SavedParserConfig | null;
  selectedPreset: ParserConfigPreset;
  selectedPresetForm: OpticalFormPreset;
  selectedPresetVersion: string;
  selectedTemplate?: OpticalFormTemplateRecord;
  selectedTemplateId: string;
  suggestion: ParserConfigSuggestion | null;
  templateApplyVersion: string;
  templateName: string;
  templateVersion: string;
  templates: OpticalFormTemplateRecord[];
  version: string;
  onFileChange: (file: File | undefined) => void | Promise<void>;
  onPresetChange: (value: ParserConfigPreset) => void;
  onPresetSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSuggestionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTemplateApplySubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTemplateApplyVersionChange: (value: string) => void;
  onTemplateCreate: () => void | Promise<void>;
  onTemplateIdChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateVersionChange: (value: string) => void;
  onVersionChange: (value: string) => void;
}

function OpticalFormatSetup({
  examId,
  fileName,
  savedConfig,
  selectedPreset,
  selectedPresetForm,
  selectedPresetVersion,
  selectedTemplate,
  selectedTemplateId,
  suggestion,
  templateApplyVersion,
  templateName,
  templateVersion,
  templates,
  version,
  onFileChange,
  onPresetChange,
  onPresetSubmit,
  onSuggestionSubmit,
  onTemplateApplySubmit,
  onTemplateApplyVersionChange,
  onTemplateCreate,
  onTemplateIdChange,
  onTemplateNameChange,
  onTemplateVersionChange,
  onVersionChange,
}: OpticalFormatSetupProps) {
  return (
    <section className="next-optical-format-grid" aria-label="Format seç ve ilerle">
      <Panel
        as="form"
        aria-label="Format seç ve ilerle"
        className="next-optical-format-panel next-optical-format-panel--wide"
        description="Kayıtlı TXT/DAT formu seçili sınav için kullanılacak. Sürüm form yapısından otomatik türetilir."
        title="Format seç ve ilerle"
        onSubmit={(event) => void onPresetSubmit(event)}
      >
        <Field label="Kayıtlı TXT/DAT formu">
          <Select
            value={selectedPreset}
            onChange={(event) => onPresetChange(event.target.value as ParserConfigPreset)}
          >
            {opticalFormPresets.map((form) => (
              <option key={form.preset} value={form.preset}>
                {form.name}
              </option>
            ))}
          </Select>
        </Field>
        <InfoGrid className="next-optical-form-meta" aria-label="Seçili form özeti">
          <InfoItem label="Kaynak" value={selectedPresetForm.sourceType} />
          <InfoItem label="Satır uzunluğu" value={`${selectedPresetForm.rowLength} karakter`} />
          <InfoItem label="Soru" value={`${selectedPresetForm.questionCount} soru`} />
          <InfoItem label="Sürüm" value={selectedPresetVersion} />
        </InfoGrid>
        {renderOpticalFormPreview(selectedPresetForm.rows)}
        <InfoGrid className="next-parser-summary" aria-live="polite">
          {suggestion ? (
            <>
              <InfoItem label="Ayraç" value={suggestion.delimiter} />
              <InfoItem label="Başlık satırı" value={suggestion.skipHeaderLines} />
              <InfoItem label="Güven" value={suggestion.confidence} />
              <InfoItem label="Soru tahmini" value={suggestion.fieldMapping.answers.estimatedQuestionCount} />
            </>
          ) : (
            <InfoItem label="Format" value="Format seçimi bekliyor" />
          )}
        </InfoGrid>
        <Button disabled={!examId} type="submit">
          <CheckCircle2 size={17} aria-hidden="true" />
          Seç ve ilerle
        </Button>
        {savedConfig ? <p>{savedConfig.version} seçildi. Optik yükleme adımında bu sürüm kullanılacak.</p> : null}
      </Panel>

      <details className="next-optical-format-panel next-optical-format-details next-advanced-details">
        <summary>Farklı dosya formatı ve kurum şablonları</summary>
        <form className="next-inline-form" onSubmit={(event) => void onSuggestionSubmit(event)}>
          <Field label="Dosyadan format tanı">
            <Input accept=".txt,.dat,text/plain" type="file" onChange={(event) => void onFileChange(event.target.files?.[0])} />
          </Field>
          <Field label="Dosya format sürümü">
            <Input required value={version} onChange={(event) => onVersionChange(event.target.value)} />
          </Field>
          <Button disabled={!examId} type="submit">
            <FileText size={17} aria-hidden="true" />
            Dosyayı analiz edip kaydet
          </Button>
        </form>
        {fileName ? <p>{fileName}</p> : null}
        <form className="next-inline-form" onSubmit={(event) => void onTemplateApplySubmit(event)}>
          <Field label="Kayıtlı kurum formu">
            <Select
              value={selectedTemplateId}
              onChange={(event) => onTemplateIdChange(event.target.value)}
            >
              {templates.length === 0 ? <option value="">Şablon yok</option> : null}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
            </Select>
          </Field>
          <Field label="Kurum formu sürümü">
            <Input required value={templateApplyVersion} onChange={(event) => onTemplateApplyVersionChange(event.target.value)} />
          </Field>
          <Button disabled={!selectedTemplateId || !examId} type="submit">
            <CheckCircle2 size={17} aria-hidden="true" />
            Sınava uygula
          </Button>
        </form>
        {selectedTemplate ? renderOpticalFormPreview(createTemplatePreviewRows(selectedTemplate)) : null}
        <div className="next-inline-form">
          <Field label="Yeni kurum formu adı">
            <Input value={templateName} onChange={(event) => onTemplateNameChange(event.target.value)} />
          </Field>
          <Field label="Şablon sürümü">
            <Input value={templateVersion} onChange={(event) => onTemplateVersionChange(event.target.value)} />
          </Field>
          <Button disabled={!suggestion} type="button" onClick={() => void onTemplateCreate()}>
            <Upload size={17} aria-hidden="true" />
            Kurum formu olarak kaydet
          </Button>
        </div>
      </details>
    </section>
  );
}

interface AnswerKeySetupProps {
  answerKeyDryRun: AnswerKeyImportDryRunResult | null;
  answerKeyFileName: string;
  answerKeyImport: AnswerKeyImportResult | null;
  answerKeyVersion: string;
  manualAnswerKey: AnswerKeyRecord | null;
  manualAnswerKeyVersion: string;
  manualAnswerText: string;
  manualBPermutationText: string;
  manualDryRun: ManualAnswerKeyDryRunResult | null;
  manualQuestions: ManualAnswerKeyQuestion[];
  onAnswerKeyDryRunSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAnswerKeyFileChange: (file: File | undefined) => void | Promise<void>;
  onAnswerKeyImport: () => void | Promise<void>;
  onAnswerKeyVersionChange: (value: string) => void;
  onManualAnswerKeyVersionChange: (value: string) => void;
  onManualAnswerTextApply: () => void;
  onManualAnswerTextChange: (value: string) => void;
  onManualBPermutationTextChange: (value: string) => void;
  onManualQuestionChange: (questionNo: number, patch: Partial<ManualAnswerKeyQuestion>) => void;
  onManualSave: (dryRun: boolean) => void | Promise<void>;
}

type AnswerKeyBranchRow = AnswerKeyImportDryRunResult["branches"][number];

const answerKeyBranchColumns: Array<DataTableColumn<AnswerKeyBranchRow>> = [
  {
    header: "Branş",
    key: "branch",
    mobilePriority: "primary",
    priority: "primary",
    render: (branch) => formatCourseName(branch.branch),
  },
  {
    align: "right",
    header: "Soru",
    key: "questionCount",
    mobilePriority: "secondary",
    priority: "primary",
    render: (branch) => branch.questionCount,
  },
];

function AnswerKeySetup({
  answerKeyDryRun,
  answerKeyFileName,
  answerKeyImport,
  answerKeyVersion,
  manualAnswerKey,
  manualAnswerKeyVersion,
  manualAnswerText,
  manualBPermutationText,
  manualDryRun,
  manualQuestions,
  onAnswerKeyDryRunSubmit,
  onAnswerKeyFileChange,
  onAnswerKeyImport,
  onAnswerKeyVersionChange,
  onManualAnswerKeyVersionChange,
  onManualAnswerTextApply,
  onManualAnswerTextChange,
  onManualBPermutationTextChange,
  onManualQuestionChange,
  onManualSave,
}: AnswerKeySetupProps) {
  const manualAnswerKeyColumns: Array<DataTableColumn<ManualAnswerKeyQuestion>> = [
    {
      align: "right",
      header: "Soru",
      key: "question",
      mobilePriority: "primary",
      priority: "primary",
      render: (question) => question.questionNo,
      sticky: "left",
    },
    {
      header: "Şık",
      key: "answer",
      mobilePriority: "primary",
      priority: "primary",
      render: (question) => (
        <Select
          aria-label={`${question.questionNo}. soru şıkkı`}
          value={question.correctAnswer}
          onChange={(event) => onManualQuestionChange(question.questionNo, { correctAnswer: event.target.value as ManualAnswerChoice })}
        >
          <option value="">Seç</option>
          {answerChoices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Branş",
      key: "branch",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (question) => (
        <Input
          aria-label={`${question.questionNo}. soru branşı`}
          value={question.branch}
          onChange={(event) => onManualQuestionChange(question.questionNo, { branch: event.target.value })}
        />
      ),
    },
    {
      header: "Kazanım",
      key: "outcome",
      mobilePriority: "hidden",
      priority: "optional",
      render: (question) => (
        <Input
          aria-label={`${question.questionNo}. soru kazanımı`}
          value={question.outcomeCode}
          onChange={(event) => onManualQuestionChange(question.questionNo, { outcomeCode: event.target.value })}
        />
      ),
    },
    {
      header: "Konu",
      key: "topic",
      mobilePriority: "hidden",
      priority: "optional",
      render: (question) => (
        <Input
          aria-label={`${question.questionNo}. soru konusu`}
          value={question.topic}
          onChange={(event) => onManualQuestionChange(question.questionNo, { topic: event.target.value })}
        />
      ),
    },
  ];

  return (
    <section className="next-optical-answer-key-grid" aria-label="Cevap anahtarı">
      <Panel
        as="form"
        aria-label="Cevap anahtarı Excel import"
        className="next-optical-answer-key-panel"
        description="Excel cevap anahtarını ön kontrolden geçir ve doğrulanan sürümü içe aktar."
        title="Excel ile hazırla"
        onSubmit={(event) => void onAnswerKeyDryRunSubmit(event)}
      >
        <Field label="Anahtar sürümü">
          <Input required value={answerKeyVersion} onChange={(event) => onAnswerKeyVersionChange(event.target.value)} />
        </Field>
        <Field label="Cevap anahtarı dosyası">
          <Input accept=".xlsx" type="file" onChange={(event) => void onAnswerKeyFileChange(event.target.files?.[0])} />
        </Field>
        {answerKeyFileName ? <p>{answerKeyFileName}</p> : null}
        <Button type="submit">
          <FileSpreadsheet size={17} aria-hidden="true" />
          Ön kontrol
        </Button>
        <Button disabled={!answerKeyDryRun} type="button" onClick={() => void onAnswerKeyImport()}>
          <Upload size={17} aria-hidden="true" />
          İçe aktar
        </Button>
      </Panel>
      <Panel
        aria-label="Cevap anahtarı özeti"
        className="next-optical-answer-key-panel"
        description="Ön kontrol sonucu, kitapçık varyantları ve branş soru dağılımı."
        title="Anahtar özeti"
      >
        {answerKeyDryRun ? (
          <>
            <p>{answerKeyDryRun.questionCount} soru doğrulandı.</p>
            <p>{answerKeyDryRun.bookletVariants.map((variant) => `${variant.code}: ${variant.questionCount} soru`).join(", ")}</p>
            <DataTable
              caption="Cevap anahtarı branş dağılımı"
              columns={answerKeyBranchColumns}
              density="compact"
              getRowKey={(branch) => branch.branch}
              rows={answerKeyDryRun.branches}
            />
          </>
        ) : (
          <p>Excel dosyası ön kontrol bekliyor.</p>
        )}
        {answerKeyImport ? <p>Excel cevap anahtarı içe aktarıldı.</p> : null}
      </Panel>
      <Panel
        aria-label="Manuel cevap anahtarı"
        className="next-optical-answer-key-panel next-optical-answer-key-panel--wide"
        description="Şık dizisini, kitapçık sırasını ve soru bazlı branş/kazanım bağlamını elle düzenle."
        title="Manuel giriş"
      >
        <div className="next-inline-form">
          <Field label="Manuel sürüm">
            <Input required value={manualAnswerKeyVersion} onChange={(event) => onManualAnswerKeyVersionChange(event.target.value)} />
          </Field>
          <Field label="Şık dizisi">
            <Input
              aria-label="90 şık dizisi"
              value={manualAnswerText}
              onChange={(event) => onManualAnswerTextChange(event.target.value)}
              placeholder="ABCDE..."
            />
          </Field>
          <Field label="B kitapçık sırası">
            <Input
              aria-label="B kitapçık sırası"
              value={manualBPermutationText}
              onChange={(event) => onManualBPermutationTextChange(event.target.value)}
              placeholder="90 89 ... 1"
            />
          </Field>
          <Button type="button" onClick={onManualAnswerTextApply}>
            Gridi doldur
          </Button>
        </div>
        <div className="next-grid-scroll">
          <DataTable
            caption="Manuel cevap anahtarı grid'i"
            columns={manualAnswerKeyColumns}
            density="compact"
            description="Soru bazlı şık, branş, kazanım ve konu bilgisi."
            getRowKey={(question) => String(question.questionNo)}
            rows={manualQuestions}
          />
        </div>
        <div className="next-row-actions">
          <Button type="button" onClick={() => void onManualSave(true)}>
            Ön kontrol
          </Button>
          <Button disabled={!manualDryRun} type="button" onClick={() => void onManualSave(false)}>
            Kaydet
          </Button>
        </div>
        {manualDryRun ? (
          <p>
            {manualDryRun.questionCount} manuel soru doğrulandı.
            {manualDryRun.bookletVariants.length
              ? ` ${manualDryRun.bookletVariants.map((variant) => `${variant.code}: ${variant.questionCount} soru`).join(", ")}`
              : ""}
          </p>
        ) : null}
        {manualAnswerKey ? <p>Manuel cevap anahtarı kaydedildi.</p> : null}
      </Panel>
    </section>
  );
}

interface OpticalUploadPanelProps {
  evaluationJobs: RawImportEvaluationQueueResult | null;
  evaluationStatus: RawImportEvaluationStatus | null;
  isEvaluationSubmitting: boolean;
  isRawImportChecking: boolean;
  isRawImportSubmitting: boolean;
  rawImport: RawImportUploadResult | null;
  rawImportFileName: string;
  rawImportParserVersion: string;
  rawImportSummary: RawImportParseSummary | null;
  onEvaluationStart: () => void | Promise<void>;
  onFileChange: (file: File | undefined) => void | Promise<void>;
  onParserVersionChange: (value: string) => void;
  onRefreshSummary: () => void | Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function OpticalUploadPanel({
  evaluationJobs,
  evaluationStatus,
  isEvaluationSubmitting,
  isRawImportChecking,
  isRawImportSubmitting,
  rawImport,
  rawImportFileName,
  rawImportParserVersion,
  rawImportSummary,
  onEvaluationStart,
  onFileChange,
  onParserVersionChange,
  onRefreshSummary,
  onSubmit,
}: OpticalUploadPanelProps) {
  const uploadButtonLabel = isRawImportSubmitting ? "Yükleniyor" : isRawImportChecking ? "Kontrol ediliyor" : "Yükle ve kontrol et";
  const resultStatus = rawImportSummary ? "Kontrol tamamlandı" : rawImport ? "Kontrol bekleniyor" : "Dosya bekleniyor";

  return (
    <section className="next-optical-upload-grid" aria-label="Optik yükleme">
      <Panel
        as="form"
        aria-label="Optik dosyayı yükle"
        className="next-optical-upload-panel"
        description={`Seçili format sürümü: ${rawImportParserVersion}`}
        title="Optik dosyayı yükle"
        onSubmit={(event) => void onSubmit(event)}
      >
        <details className="next-advanced-details">
          <summary>Gelişmiş format sürümü</summary>
          <Field label="Teknik format sürümü">
            <Input required value={rawImportParserVersion} onChange={(event) => onParserVersionChange(event.target.value)} />
          </Field>
        </details>
        <Field label="Optik cevap dosyası">
          <Input accept=".txt,.dat,text/plain" type="file" onChange={(event) => void onFileChange(event.target.files?.[0])} />
        </Field>
        {rawImportFileName ? <p>{formatSelectedFileNotice(rawImportFileName)}</p> : null}
        <Button type="submit" disabled={isRawImportSubmitting || isRawImportChecking}>
          <Upload size={17} aria-hidden="true" />
          {uploadButtonLabel}
        </Button>
      </Panel>
      <Panel
        actions={<span className="next-reference-badge">{resultStatus}</span>}
        aria-label="Optik yükleme sonucu"
        className="next-optical-upload-panel next-optical-upload-panel--wide"
        description="Yüklenen dosya kontrolü, güvenli teknik referanslar ve analiz başlatma durumu."
        title="Yükleme sonucu"
      >
        {rawImport ? (
          <>
            <p>{isRawImportChecking ? "Dosya alındı, satırlar kontrol ediliyor." : "Yüklenen optik dosya alındı."}</p>
            <details className="next-advanced-details">
              <summary>Teknik yükleme bilgisi</summary>
              <p>{formatEvidenceSafeReference(rawImport.rawImport.id, "Dosya ref")}</p>
              <p>{formatEvidenceSafeReference(rawImport.parseJob.jobId, "Kuyruk ref")}</p>
              <p>{formatEvidenceSafeReference(rawImport.rawImport.sha256, "Dosya izi")}</p>
              <p>Ham id, kuyruk id ve dosya izi ekran görüntülerinde gösterilmez.</p>
            </details>
            <div className="next-optical-step-actions">
              <Button type="button" variant="secondary" onClick={() => void onRefreshSummary()} disabled={isRawImportChecking}>
                <RefreshCw size={17} aria-hidden="true" />
                {isRawImportChecking ? "Özet alınıyor" : "Özeti yenile"}
              </Button>
              <Button type="button" onClick={() => void onEvaluationStart()} disabled={!rawImportSummary || isEvaluationSubmitting}>
                <Play size={17} aria-hidden="true" />
                {isEvaluationSubmitting ? "Analiz bekleniyor" : "Analizi başlat"}
              </Button>
            </div>
          </>
        ) : (
          <p>TXT/DAT dosyasını seçip yükleyin; kontrol sonucu burada görünecek.</p>
        )}
        {rawImportSummary ? (
          <InfoGrid className="next-parser-summary" aria-live="polite">
            <InfoItem label="Toplam" value={rawImportSummary.totalRows} />
            <InfoItem label="Eşleşen" value={rawImportSummary.matchedCount} />
            <InfoItem label="Eşleşmeyen" value={rawImportSummary.quarantinedCount} />
            <InfoItem label="Sebep" value={formatQuarantineReasons(rawImportSummary)} />
          </InfoGrid>
        ) : null}
        {evaluationJobs ? (
          <p>
            {evaluationJobs.queuedCount}/{evaluationJobs.matchedCount} analiz işi kuyruğa alındı.
            {isEvaluationSubmitting ? " Sonuçlar bekleniyor." : ""}
          </p>
        ) : null}
        {evaluationStatus ? (
          <p>
            {evaluationStatus.evaluatedCount}/{evaluationStatus.matchedCount} analiz sonucu tamamlandı.
          </p>
        ) : null}
      </Panel>
    </section>
  );
}

interface QuarantineResolutionPanelProps {
  quarantineRawImportId: string;
  quarantines: ImportQuarantineRecord[];
  selectedStudentByQuarantine: Record<string, string>;
  students: StudentRecord[];
  onLookupSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQuarantineRawImportIdChange: (value: string) => void;
  onResolve: (record: ImportQuarantineRecord) => void | Promise<void>;
  onSelectedStudentChange: (updater: (current: Record<string, string>) => Record<string, string>) => void;
}

function QuarantineResolutionPanel({
  quarantineRawImportId,
  quarantines,
  selectedStudentByQuarantine,
  students,
  onLookupSubmit,
  onQuarantineRawImportIdChange,
  onResolve,
  onSelectedStudentChange,
}: QuarantineResolutionPanelProps) {
  const quarantineColumns: Array<DataTableColumn<ImportQuarantineRecord>> = [
    {
      align: "right",
      header: "Satır",
      key: "rowNumber",
      mobilePriority: "secondary",
      priority: "primary",
      render: (record) => record.rowNumber,
    },
    {
      header: "Sebep",
      key: "reason",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => record.reason,
    },
    {
      header: "Durum",
      key: "status",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => (
        <StatusBadge tone={quarantineStatusTone(record.status)}>{formatQuarantineStatus(record.status)}</StatusBadge>
      ),
    },
    {
      header: "Öğrenci",
      key: "student",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => (
        <Select
          aria-label={`${record.rowNumber}. satır öğrencisi`}
          value={selectedStudentByQuarantine[record.id] ?? record.resolvedStudentId ?? ""}
          onChange={(event) =>
            onSelectedStudentChange((current) => ({ ...current, [record.id]: event.target.value }))
          }
        >
          <option value="">Seçiniz</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "İşlem",
      key: "action",
      mobileLabel: "Çöz",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) =>
        record.status === "RESOLVED" ? (
          record.evaluationJob ? formatEvidenceSafeReference(record.evaluationJob.jobId, "Kuyruk ref") : "Çözüldü"
        ) : (
          <button type="button" onClick={() => void onResolve(record)} aria-label={`${record.rowNumber}. satırı çöz`}>
            <CheckCircle2 size={17} aria-hidden="true" />
          </button>
        ),
    },
  ];

  return (
    <>
      <Panel
        as="form"
        aria-label="Eşleşmeyen satırları çöz"
        className="next-optical-quarantine-panel"
        description={quarantineRawImportId ? "Yüklenen optik dosya seçili." : "Önce optik dosya yükleyin."}
        title="Eşleşmeyen satırları çöz"
        onSubmit={(event) => void onLookupSubmit(event)}
      >
        <details className="next-advanced-details">
          <summary>Yüklenen dosya kaydı</summary>
          <Field label="Yüklenen optik dosya">
            <Input required type="password" value={quarantineRawImportId} onChange={(event) => onQuarantineRawImportIdChange(event.target.value)} />
          </Field>
        </details>
        <Button type="submit">
          <Wand2 size={17} aria-hidden="true" />
          Eşleşmeyen satırları getir
        </Button>
      </Panel>
      <Panel
        aria-label="Eşleşmeyen satır listesi"
        className="next-optical-quarantine-panel next-optical-quarantine-panel--wide"
        description="Öğrenciyle eşleşmeyen optik satırları çözüm durumu ve işlem aksiyonlarıyla izle."
        title="Eşleşmeyen satırlar"
      >
        <div className="next-grid-scroll">
          <DataTable
            caption="Eşleşmeyen satır listesi"
            columns={quarantineColumns}
            density="compact"
            emptyText={
              <EmptyState
                title="Eşleşmeyen satır yok"
                description="Yüklenen dosya için öğrenciyle eşleşmeyen satırlar burada listelenir."
              />
            }
            getRowKey={(record) => record.id}
            rows={quarantines}
          />
        </div>
      </Panel>
    </>
  );
}

interface OpticalReportPanelProps {
  evaluationStatus: RawImportEvaluationStatus | null;
  isReportSubmitting: boolean;
  participants: ExamParticipantRecord[];
  reportContentHash: string;
  reportJob: ReportGenerationQueueResult | null;
  reportSnapshots: ReportSnapshotRecord[];
  students: StudentRecord[];
  onDownload: (snapshot: ReportSnapshotRecord, format: "xlsx" | "pdf") => void | Promise<void>;
  onRefreshSnapshots: () => void | Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function OpticalReportPanel({
  evaluationStatus,
  isReportSubmitting,
  participants,
  reportContentHash,
  reportJob,
  reportSnapshots,
  students,
  onDownload,
  onRefreshSnapshots,
  onSubmit,
}: OpticalReportPanelProps) {
  const hasReportInput = Boolean(reportContentHash.trim());
  const isAnalysisComplete = evaluationStatus?.status === "COMPLETED" && evaluationStatus.evaluatedCount > 0;
  const canGenerateReport = hasReportInput && isAnalysisComplete && !isReportSubmitting;
  const reportMessage = getReportReadinessMessage(evaluationStatus, hasReportInput, isReportSubmitting);
  const latestSnapshot = reportSnapshots[0] ?? null;
  const studentRows = buildReportAnalysisRows({ participants, snapshot: latestSnapshot, students });
  const reportSnapshotColumns: Array<DataTableColumn<ReportSnapshotRecord>> = [
    {
      header: "Durum",
      key: "status",
      mobilePriority: "primary",
      priority: "primary",
      render: (snapshot) => (
        <StatusBadge tone={reportSnapshotStatusTone(snapshot.status)}>{formatReportStatus(snapshot.status)}</StatusBadge>
      ),
    },
    {
      header: "Çıktı",
      key: "exportReadiness",
      mobilePriority: "primary",
      priority: "primary",
      render: (snapshot) => (
        <StatusBadge tone={isReportSnapshotReady(snapshot) ? "success" : "warning"}>
          {isReportSnapshotReady(snapshot) ? "Excel/PDF hazır" : "READY bekleniyor"}
        </StatusBadge>
      ),
    },
    {
      align: "right",
      header: "Sonuç",
      key: "resultCount",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (snapshot) => formatReportResultCount(snapshot),
    },
    {
      align: "right",
      header: "Başarı %",
      key: "successRate",
      mobilePriority: "primary",
      priority: "primary",
      render: (snapshot) => formatPercentNumber(reportSuccessRate(snapshot.snapshotData?.averages)),
    },
    {
      align: "right",
      header: "Net",
      key: "net",
      mobilePriority: "secondary",
      priority: "primary",
      render: (snapshot) => formatReportNumber(snapshot.snapshotData?.averages?.net),
    },
    {
      align: "right",
      header: "Soru",
      key: "questionCount",
      mobilePriority: "secondary",
      priority: "primary",
      render: (snapshot) => formatReportNumber(reportQuestionCount(snapshot.snapshotData?.averages)),
    },
    {
      align: "right",
      header: "Doğru",
      key: "correct",
      mobilePriority: "hidden",
      priority: "optional",
      render: (snapshot) => formatReportAverage(snapshot, "correct"),
    },
    {
      align: "right",
      header: "Yanlış",
      key: "wrong",
      mobilePriority: "hidden",
      priority: "optional",
      render: (snapshot) => formatReportAverage(snapshot, "wrong"),
    },
    {
      align: "right",
      header: "Boş",
      key: "blank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (snapshot) => formatReportAverage(snapshot, "blank"),
    },
    {
      align: "right",
      header: "Sınıf",
      key: "classCount",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (snapshot) => formatReportClassCount(snapshot),
    },
    {
      header: "Oluşturulma",
      key: "generatedAt",
      mobilePriority: "hidden",
      priority: "optional",
      render: (snapshot) => formatReportGeneratedAt(snapshot),
    },
    {
      header: "İndirme",
      key: "download",
      mobileLabel: "İndir",
      mobilePriority: "primary",
      priority: "primary",
      render: (snapshot) => (
        <div className="next-row-actions">
          <button
            type="button"
            disabled={!isReportSnapshotReady(snapshot)}
            onClick={() => void onDownload(snapshot, "xlsx")}
            aria-label={`${formatReportStatus(snapshot.status)} optik raporu Excel indir`}
            title={isReportSnapshotReady(snapshot) ? "Excel indir" : "READY snapshot gerekli"}
          >
            <Download size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!isReportSnapshotReady(snapshot)}
            onClick={() => void onDownload(snapshot, "pdf")}
            aria-label={`${formatReportStatus(snapshot.status)} optik raporu PDF indir`}
            title={isReportSnapshotReady(snapshot) ? "PDF indir" : "READY snapshot gerekli"}
          >
            <FileText size={17} aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        as="form"
        aria-label="Optik rapor üretimi"
        className="next-optical-report-panel next-optical-report-panel--wide"
        description={reportMessage}
        title="Rapor üretimi"
        onSubmit={(event) => void onSubmit(event)}
      >
        <MetricGrid aria-label="Rapor üretim durumu" role="region">
          <MetricCard
            label="Analiz"
            tone={evaluationStatus?.status === "COMPLETED" ? "success" : "warning"}
            value={evaluationStatus?.status === "COMPLETED" ? "Tamamlandı" : "Bekleniyor"}
          />
          <MetricCard
            label="Sonuç"
            description="Değerlendirilen / eşleşen"
            value={evaluationStatus ? `${evaluationStatus.evaluatedCount}/${evaluationStatus.matchedCount}` : "-"}
          />
          <MetricCard
            label="Hazır rapor"
            description="READY snapshot indirmeye açıktır"
            tone={reportSnapshots.some((snapshot) => snapshot.status === "READY") ? "success" : "default"}
            value={reportSnapshots.length}
          />
        </MetricGrid>
        <div className="next-optical-step-actions">
          <Button disabled={!canGenerateReport} type="submit">
            <RefreshCw size={17} aria-hidden="true" />
            {isReportSubmitting ? "Hazırlanıyor" : "Rapor üret"}
          </Button>
          <Button type="button" onClick={() => void onRefreshSnapshots()}>
            <FileText size={17} aria-hidden="true" />
            Raporları getir
          </Button>
        </div>
        {reportJob ? (
          <details className="next-advanced-details">
            <summary>Rapor işi kuyruğa alındı.</summary>
            <p>{formatEvidenceSafeReference(reportJob.jobId, "Rapor kuyruk ref")}</p>
            <p>Ham kuyruk id ekran görüntülerinde gösterilmez.</p>
          </details>
        ) : null}
      </Panel>
      <Panel
        aria-label="Rapor listesi"
        className="next-optical-report-panel next-optical-report-panel--wide"
        description="READY snapshot çıktıları, üretim tarihi ve indirme durumu tek listede izlenir."
        title="Hazır raporlar"
      >
        {reportSnapshots.length > 0 ? (
          <div className="next-grid-scroll">
            <DataTable
              caption="Hazır optik raporlar"
              columns={reportSnapshotColumns}
              description="Başarı % ana karşılaştırma metriğidir; Net ve Soru bağlam olarak gösterilir. Excel/PDF indirme yalnız READY snapshot için açıktır."
              density="compact"
              getRowKey={(snapshot) => snapshot.id}
              rows={reportSnapshots}
            />
          </div>
        ) : (
          <EmptyState title="Hazır rapor yok" description="Rapor ürettiğinizde Excel ve PDF indirme seçenekleri burada görünür." />
        )}
      </Panel>
      <OpticalStudentResultsTable rows={studentRows} />
    </>
  );
}

function OpticalStudentResultsTable({ rows }: { rows: ReportAnalysisRow[] }) {
  const columns: Array<DataTableColumn<ReportAnalysisRow>> = [
    {
      header: "Öğrenci",
      key: "student",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <>
          <span className="next-report-student-name">{row.studentName}</span>
          {row.studentNo ? <small>#{row.studentNo}</small> : null}
        </>
      ),
      sticky: "left",
    },
    {
      header: "Sınıf",
      key: "class",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => row.className,
    },
    {
      header: "Katılım",
      key: "participation",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatParticipantMeta(row),
    },
    {
      header: "Durum",
      key: "status",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => <StatusBadge tone={resultStatusTone(row)}>{formatResultStatus(row)}</StatusBadge>,
    },
    {
      align: "right",
      header: "Başarı %",
      key: "successRate",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => formatPercentNumber(reportSuccessRate(row)),
    },
    {
      align: "right",
      header: "Net",
      key: "net",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => formatReportNumber(row.net),
    },
    {
      align: "right",
      header: "Soru",
      key: "questionCount",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => formatReportNumber(reportQuestionCount(row)),
    },
    {
      align: "right",
      header: "Doğru",
      key: "correct",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatReportNumber(row.correct),
    },
    {
      align: "right",
      header: "Yanlış",
      key: "wrong",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatReportNumber(row.wrong),
    },
    {
      align: "right",
      header: "Boş",
      key: "blank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatReportNumber(row.blank),
    },
    {
      align: "right",
      header: "Puan",
      key: "score",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (row) => formatReportNumber(readRowScore(row)),
    },
    {
      align: "right",
      header: "Genel sıra",
      key: "generalRank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatRank(row.generalRank),
    },
    {
      align: "right",
      header: "Sınıf sıra",
      key: "classRank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatRank(row.classRank),
    },
    {
      align: "right",
      header: "Yüzdelik",
      key: "percentile",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatPercentile(row.percentile),
    },
  ];

  return (
    <Panel
      aria-label="Katılan öğrenciler"
      className="next-optical-report-panel next-optical-report-panel--wide"
      description="Öğrenci bazlı başarı dağılımı, soru sayısı, puan ve sıralama bağlamıyla izlenir."
      title="Katılan öğrenciler"
    >
      {rows.length > 0 ? (
        <div className="next-grid-scroll">
          <DataTable
            caption="Optik katılımcı sonuçları"
            className="next-report-analysis-table"
            columns={columns}
            description="Başarı % ana karşılaştırma metriğidir; Net, Soru, puan ve sıralama bağlam olarak gösterilir."
            density="compact"
            getRowKey={(row) => row.rowKey}
            rows={rows}
          />
        </div>
      ) : (
        <EmptyState
          title="Katılımcı sonucu yok"
          description="Hazır rapor geldiğinde katılan öğrenci listesi burada görünür."
        />
      )}
    </Panel>
  );
}

function getReportReadinessMessage(
  evaluationStatus: RawImportEvaluationStatus | null,
  hasReportInput: boolean,
  isReportSubmitting: boolean,
): string {
  if (isReportSubmitting) return "Rapor hazırlanıyor.";
  if (!hasReportInput) return "Rapor üretmek için önce optik analizini tamamlayın.";
  if (evaluationStatus?.status !== "COMPLETED") return "Analiz tamamlanınca rapor üretilebilir.";
  if (evaluationStatus.evaluatedCount <= 0) return "Rapor için değerlendirilmiş öğrenci yok.";
  return `${evaluationStatus.evaluatedCount} öğrenci için rapor hazır.`;
}

function quarantineStatusTone(status: string): "danger" | "info" | "neutral" | "success" | "warning" {
  if (status === "RESOLVED") return "success";
  if (status === "OPEN" || status === "PENDING") return "warning";
  return "neutral";
}

function formatQuarantineStatus(status: string): string {
  if (status === "RESOLVED") return "Çözüldü";
  if (status === "OPEN" || status === "PENDING") return "Bekliyor";
  return status;
}

function reportSnapshotStatusTone(status: string): "danger" | "info" | "neutral" | "success" | "warning" {
  if (status === "READY") return "success";
  if (status === "STALE") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function isReportSnapshotReady(snapshot: ReportSnapshotRecord): boolean {
  return snapshot.status === "READY";
}

function formatReportStatus(status: string): string {
  if (status === "READY") return "Hazır";
  if (status === "STALE") return "Eski";
  if (status === "PENDING") return "Bekliyor";
  if (status === "FAILED") return "Hatalı";
  return status;
}

function formatReportResultCount(snapshot: ReportSnapshotRecord): string {
  const resultCount = snapshot.snapshotData?.resultCount;
  return typeof resultCount === "number" || typeof resultCount === "string" ? String(resultCount) : "-";
}

function formatReportAverage(
  snapshot: ReportSnapshotRecord,
  key: "blank" | "correct" | "net" | "wrong",
): string {
  return formatReportNumber(snapshot.snapshotData?.averages?.[key]);
}

function formatReportClassCount(snapshot: ReportSnapshotRecord): string {
  return String(snapshot.snapshotData?.classes?.length ?? 0);
}

function formatReportGeneratedAt(snapshot: ReportSnapshotRecord): string {
  const generatedAt = snapshot.generatedAt ?? snapshot.createdAt;
  if (!generatedAt) return "-";
  return new Date(generatedAt).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatParticipantMeta(row: ReportAnalysisRow): string {
  const parts = [row.participantNo, row.bookletType ? `${row.bookletType} kitapçık` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatResultStatus(row: ReportAnalysisRow): string {
  if (row.resultStatus === "READY") return "Sonuç var";
  if (row.resultStatus === "ABSENT") return "Katılmadı";
  return "Sonuç yok";
}

function resultStatusTone(row: ReportAnalysisRow): "danger" | "info" | "neutral" | "success" | "warning" {
  if (row.resultStatus === "READY") return "success";
  if (row.resultStatus === "ABSENT") return "warning";
  return "neutral";
}

function readRowScore(row: ReportAnalysisRow): number | undefined {
  return row.estimatedRawScore ?? row.standardScore ?? row.rawScore;
}

function formatRank(rank: ReportAnalysisRow["generalRank"]): string {
  return rank ? `${rank.rank}/${rank.outOf}` : "-";
}

function formatPercentile(value: number | undefined): string {
  return value === undefined ? "-" : `%${formatReportNumber(value)}`;
}

function formatReportNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

async function suggestParserConfig(
  accessToken: string,
  examId: string,
  input:
    | Pick<ParserConfigSuggestionFormPayload, "sampleText">
    | Pick<ParserConfigSuggestionFormPayload, "fileBase64">
    | { preset: ParserConfigPreset },
) {
  return apiRequest<ParserConfigSuggestionResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/parser-configs/suggestions`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function loadOpticalExams(accessToken: string) {
  return apiRequest<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
}

async function createOpticalExam(accessToken: string, input: { title: string; startsAt?: string }) {
  return apiRequest<ExamRecord>(
    accessToken,
    `${apiBaseUrl}/exams`,
    {
      body: JSON.stringify({
        title: input.title,
        ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function approveParserConfig(
  accessToken: string,
  examId: string,
  version: string,
  suggestion: ParserConfigSuggestion,
) {
  return apiRequest<SavedParserConfig>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/parser-configs/approvals`,
    {
      body: JSON.stringify({ version, suggestion }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function loadOpticalFormTemplates(accessToken: string) {
  return apiRequest<OpticalFormTemplateRecord[]>(accessToken, `${apiBaseUrl}/optical-form-templates`);
}

async function createOpticalFormTemplate(
  accessToken: string,
  input: { name: string; version: string; suggestion: ParserConfigSuggestion },
) {
  return apiRequest<OpticalFormTemplateRecord>(
    accessToken,
    `${apiBaseUrl}/optical-form-templates`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function applyOpticalFormTemplate(
  accessToken: string,
  templateId: string,
  input: { examId: string; version: string },
) {
  return apiRequest<SavedParserConfig>(
    accessToken,
    `${apiBaseUrl}/optical-form-templates/${encodeURIComponent(templateId)}/apply`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function dryRunAnswerKeyImport(accessToken: string, input: AnswerKeyImportFormPayload) {
  return apiRequest<AnswerKeyImportDryRunResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/answer-keys/imports/dry-run`,
    {
      body: JSON.stringify({ version: input.version, fileBase64: input.fileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function importAnswerKey(accessToken: string, input: AnswerKeyImportFormPayload) {
  return apiRequest<AnswerKeyImportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/answer-keys/imports`,
    {
      body: JSON.stringify({ version: input.version, fileBase64: input.fileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function saveManualAnswerKey(
  accessToken: string,
  input: {
    examId: string;
    version: string;
    questions: Array<{
      questionNo: number;
      correctAnswer: AnswerChoice;
      branch: string;
      outcomeCode?: string;
      topic?: string;
    }>;
    bookletVariants: Array<{ code: string; permutation: number[] }>;
    dryRun: boolean;
  },
) {
  return apiRequest<AnswerKeyRecord | ManualAnswerKeyDryRunResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/answer-keys`,
    {
      body: JSON.stringify({
        version: input.version,
        questions: input.questions,
        scoringConfig: { wrongPenalty: 1 / 3 },
        bookletVariants: input.bookletVariants,
        dryRun: input.dryRun,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function uploadRawImport(accessToken: string, input: RawImportUploadFormPayload) {
  return apiRequest<RawImportUploadResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports`,
    {
      body: JSON.stringify({
        sourceType: input.sourceType,
        fileName: input.fileName,
        fileBase64: input.fileBase64,
        contentType: "text/plain",
        parserConfigVersion: input.parserConfigVersion,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function loadRawImportSummary(accessToken: string, examId: string, rawImportId: string) {
  return apiRequest<RawImportParseSummary>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/raw-imports/${encodeURIComponent(rawImportId)}/summary`,
  );
}

async function waitForRawImportSummary(accessToken: string, examId: string, rawImportId: string) {
  return retryUntilReady(() => loadRawImportSummary(accessToken, examId, rawImportId), (summary) => summary.totalRows > 0);
}

async function enqueueRawImportEvaluation(
  accessToken: string,
  input: { examId: string; rawImportId: string; answerKeyId?: string },
) {
  return apiRequest<RawImportEvaluationQueueResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/evaluation-jobs`,
    {
      body: JSON.stringify({ answerKeyId: input.answerKeyId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function loadRawImportEvaluationStatus(
  accessToken: string,
  input: { examId: string; rawImportId: string; answerKeyId?: string },
) {
  const query = new URLSearchParams();
  if (input.answerKeyId) query.set("answerKeyId", input.answerKeyId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<RawImportEvaluationStatus>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/evaluation-status${suffix}`,
  );
}

async function waitForRawImportEvaluationStatus(
  accessToken: string,
  input: { examId: string; rawImportId: string; answerKeyId?: string; expectedCount: number },
) {
  let latest: RawImportEvaluationStatus | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = await loadRawImportEvaluationStatus(accessToken, input);
    if (latest.status === "COMPLETED" && latest.evaluatedCount >= input.expectedCount) {
      return latest;
    }
    await sleep(500);
  }
  throw new Error(`EVALUATION_TIMEOUT:${latest?.evaluatedCount ?? 0}/${input.expectedCount}`);
}

async function loadQuarantines(accessToken: string, input: QuarantineLookupFormPayload) {
  return apiRequest<ImportQuarantineRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/quarantines`,
  );
}

async function loadStudents(accessToken: string) {
  return apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`);
}

async function loadExamParticipants(accessToken: string, examId: string) {
  return apiRequest<ExamParticipantRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/participants`,
  );
}

async function loadReportTableContext(accessToken: string, examId: string) {
  const [participants, studentRecords] = await Promise.all([
    loadExamParticipants(accessToken, examId).catch(() => []),
    loadStudents(accessToken).catch(() => []),
  ]);
  return { participants, students: studentRecords };
}

async function resolveImportQuarantine(
  accessToken: string,
  input: { examId: string; rawImportId: string; quarantineId: string; resolvedStudentId: string },
) {
  return apiRequest<ImportQuarantineRecord>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/quarantines/${encodeURIComponent(input.quarantineId)}/resolve`,
    {
      body: JSON.stringify({ resolvedStudentId: input.resolvedStudentId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function enqueueReportGeneration(accessToken: string, examId: string, contentHash: string) {
  return apiRequest<ReportGenerationQueueResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/generation-jobs`,
    {
      body: JSON.stringify({ reportType: "EXAM_RESULT_SUMMARY", contentHash }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function loadReportSnapshots(accessToken: string, examId: string) {
  return apiRequest<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );
}

async function waitForReportSnapshots(accessToken: string, examId: string, previousReadyCount: number) {
  let latest: ReportSnapshotRecord[] | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      latest = await loadReportSnapshots(accessToken, examId);
      if (countReadyReportSnapshots(latest) > previousReadyCount) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError ?? new Error("Rapor belirlenen sürede hazır olmadı. Biraz sonra Raporları getir ile tekrar deneyin.");
}

function countReadyReportSnapshots(snapshots: ReportSnapshotRecord[]) {
  return snapshots.filter((snapshot) => snapshot.status === "READY").length;
}

async function exportReportSnapshot(accessToken: string, examId: string, snapshotId: string, format: "xlsx" | "pdf") {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.${format}`,
  );
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function retryUntilReady<T>(load: () => Promise<T>, isReady: (value: T) => boolean): Promise<T> {
  let latest: T | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      latest = await load();
      if (isReady(latest)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  if (latest !== undefined) {
    return latest;
  }
  throw lastError ?? new Error("POLL_TIMEOUT");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatQuarantineReasons(summary: RawImportParseSummary): string {
  return summary.quarantineReasons.length
    ? summary.quarantineReasons.map((item) => `${item.reason}: ${item.count}`).join(", ")
    : "-";
}

function downloadBase64File(file: ReportSnapshotExportResult) {
  const bytes = Uint8Array.from(atob(file.fileBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: file.contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function renderOpticalFormPreview(rows: OpticalFormPreviewRow[]) {
  return (
    <div className="next-optical-form-preview">
      <DataTable
        caption="Optik form alan önizlemesi"
        columns={opticalFormPreviewColumns}
        density="compact"
        description="Bölüm alanlarının başlangıç ve bitiş konumları."
        getRowKey={(row) => `${row.section}-${row.start}-${row.end}`}
        rows={rows}
      />
    </div>
  );
}

function createTemplatePreviewRows(template: OpticalFormTemplateRecord): OpticalFormPreviewRow[] {
  const rows: OpticalFormPreviewRow[] = [];
  const mapping = template.fieldMapping;

  if (mapping.nationalId) {
    rows.push(createFieldPreviewRow("TC KİMLİK NO", mapping.nationalId));
  }
  rows.push(createFieldPreviewRow("OKUL NO", mapping.studentNo));
  rows.push(createFieldPreviewRow("KİTAPÇIK TÜRÜ", mapping.bookletType));

  if (mapping.answers.segments?.length) {
    const labels = ["TÜRKÇE", "SOSYAL BİLGİLER / T.C. İNKILAP TARİHİ", "DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", "İNGİLİZCE", "MATEMATİK", "FEN BİLİMLERİ"];
    mapping.answers.segments.forEach((segment, index) => {
      rows.push({
        section: labels[index] ?? `CEVAP BLOĞU ${index + 1}`,
        start: String(segment.start + 1),
        end: String(segment.start + segment.length),
      });
    });
  } else if (mapping.answers.kind === "fixed" && mapping.answers.start !== undefined && mapping.answers.length !== undefined) {
    rows.push({
      section: "CEVAPLAR",
      start: String(mapping.answers.start + 1),
      end: String(mapping.answers.start + mapping.answers.length),
    });
  } else {
    rows.push({
      section: "CEVAPLAR",
      start: mapping.answers.column === undefined ? "-" : `Kolon ${mapping.answers.column + 1}`,
      end: mapping.answers.column === undefined ? "-" : `Kolon ${mapping.answers.column + 1}`,
    });
  }

  return rows;
}

function createFieldPreviewRow(section: string, field: ParserConfigSuggestion["fieldMapping"]["studentNo"]): OpticalFormPreviewRow {
  if (field.kind === "fixed") {
    return {
      section,
      start: String(field.start + 1),
      end: String(field.start + field.length),
    };
  }

  return {
    section,
    start: `Kolon ${field.column + 1}`,
    end: `Kolon ${field.column + 1}`,
  };
}

function createManualAnswerKeyGrid(): ManualAnswerKeyQuestion[] {
  return Array.from({ length: 90 }, (_unused, index) => {
    const questionNo = index + 1;
    return {
      questionNo,
      correctAnswer: "",
      branch: defaultCourseBranch(questionNo),
      outcomeCode: "",
      topic: "",
    };
  });
}

function defaultCourseBranch(questionNo: number): string {
  if (questionNo <= 20) return "Türkçe";
  if (questionNo <= 30) return "İnkılap";
  if (questionNo <= 40) return "Din";
  if (questionNo <= 50) return "İngilizce";
  if (questionNo <= 70) return "Matematik";
  return "Fen";
}

function parseManualBPermutation(value: string, questionCount: number): Array<{ code: string; permutation: number[] }> {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const permutation = trimmed.split(/[\s,;]+/).filter(Boolean).map((part) => Number(part));
  const unique = new Set(permutation);
  const valid =
    permutation.length === questionCount &&
    unique.size === questionCount &&
    permutation.every((item) => Number.isInteger(item) && item >= 1 && item <= questionCount);
  if (!valid) {
    throw new Error(`B kitapçık sırası ${questionCount} benzersiz sayı olmalıdır.`);
  }
  return [{ code: "B", permutation }];
}
