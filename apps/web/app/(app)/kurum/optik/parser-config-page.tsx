"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Button, EmptyState, Input } from "@uzman-hocam/ui";
import type {
  AnswerChoice,
  AnswerKeyRecord,
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
  matchedCount: number;
  queuedCount: number;
  queueName: "exam-evaluation";
  jobs: Array<{ participantId: string; jobId: string; status: "queued" }>;
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
  { id: "format", label: "Format öneri-onay" },
  { id: "answer-key", label: "Cevap anahtarı" },
  { id: "upload", label: "Optik yükleme" },
  { id: "quarantine", label: "Karantina çözümü" },
];

const answerChoices: AnswerChoice[] = ["A", "B", "C", "D", "E"];

interface OpticalFormPreviewRow {
  section: string;
  start: string;
  end: string;
}

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

export function ParserConfigPage() {
  const { auth } = useAuth();
  const [activeTab, setActiveTab] = useState<OpticalTab>("format");
  const [examId, setExamId] = useState("");
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [newExamTitle, setNewExamTitle] = useState("");
  const [newExamStartsAt, setNewExamStartsAt] = useState("");
  const [version, setVersion] = useState("parser-v1");
  const [sampleText, setSampleText] = useState("ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [suggestion, setSuggestion] = useState<ParserConfigSuggestion | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedParserConfig | null>(null);
  const [templates, setTemplates] = useState<OpticalFormTemplateRecord[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<ParserConfigPreset>("OPTIK_7108_LGS");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateVersion, setTemplateVersion] = useState("template-v1");
  const [templateApplyVersion, setTemplateApplyVersion] = useState("parser-v1");
  const [answerKeyFileName, setAnswerKeyFileName] = useState("");
  const [answerKeyFileBase64, setAnswerKeyFileBase64] = useState("");
  const [answerKeyVersion, setAnswerKeyVersion] = useState("answer-key-v1");
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
  const [rawImportParserVersion, setRawImportParserVersion] = useState("parser-v1");
  const [rawImport, setRawImport] = useState<RawImportUploadResult | null>(null);
  const [rawImportSummary, setRawImportSummary] = useState<RawImportParseSummary | null>(null);
  const [evaluationJobs, setEvaluationJobs] = useState<RawImportEvaluationQueueResult | null>(null);
  const [quarantineRawImportId, setQuarantineRawImportId] = useState("");
  const [quarantines, setQuarantines] = useState<ImportQuarantineRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentByQuarantine, setSelectedStudentByQuarantine] = useState<Record<string, string>>({});
  const [reportContentHash, setReportContentHash] = useState("");
  const [reportJob, setReportJob] = useState<ReportGenerationQueueResult | null>(null);
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshotRecord[]>([]);
  const [error, setError] = useState("");
  const selectedExam = exams.find((exam) => exam.id === examId);
  const selectedPresetForm = opticalFormPresets.find((form) => form.preset === selectedPreset) ?? opticalFormPresets[0]!;
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

  async function submitCreateExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
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
    const parsedForm = parserConfigSuggestionFormSchema.safeParse({ examId, sampleText, fileBase64 });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const result = await suggestParserConfig(
        auth.accessToken,
        parsedForm.data.examId,
        parsedForm.data.fileBase64 ? { fileBase64: parsedForm.data.fileBase64 } : { sampleText: parsedForm.data.sampleText },
      );
      setExamId(result.examId);
      setSuggestion(result.suggestion);
    } catch (suggestionError) {
      setError(apiErrorMessage(suggestionError, "Optik format önerisi alınamadı."));
    }
  }

  async function submitPresetSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    setSavedConfig(null);
    if (!examId.trim()) {
      setError("Sınav seçilmelidir.");
      return;
    }
    try {
      const result = await suggestParserConfig(auth.accessToken, examId, { preset: selectedPreset });
      setExamId(result.examId);
      setSuggestion(result.suggestion);
      setSampleText("");
      setFileName("");
      setFileBase64("");
    } catch (presetError) {
      setError(apiErrorMessage(presetError, "TXT/DAT form yapısı uygulanamadı."));
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

  async function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !suggestion) return;

    setError("");
    const parsedForm = parserConfigApprovalFormSchema.safeParse({ examId, version });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      setSavedConfig(await approveParserConfig(auth.accessToken, parsedForm.data.examId, parsedForm.data.version, suggestion));
    } catch (approvalError) {
      setError(apiErrorMessage(approvalError, "Optik format onaylanamadı."));
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
      setError("Parser versiyonu zorunludur.");
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
    setAnswerKeyFileBase64(file ? await readFileAsBase64(file) : "");
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
    try {
      const result = await uploadRawImport(auth.accessToken, parsedForm.data);
      setRawImport(result);
      setRawImportSummary(null);
      setEvaluationJobs(null);
      setQuarantineRawImportId(result.rawImport.id);
      setReportContentHash(result.rawImport.sha256);
      setReportJob(null);
      setActiveTab("quarantine");
    } catch (uploadError) {
      setError(apiErrorMessage(uploadError, "Optik cevap dosyası yüklenemedi."));
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
    try {
      setRawImportSummary(await loadRawImportSummary(auth.accessToken, examId, rawImportId));
    } catch (summaryError) {
      setError(apiErrorMessage(summaryError, "Optik ön kontrol özeti alınamadı."));
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
    try {
      const answerKeyId = answerKeyImport?.answerKey.id ?? manualAnswerKey?.id;
      setEvaluationJobs(await enqueueRawImportEvaluation(auth.accessToken, {
        examId,
        rawImportId,
        answerKeyId,
      }));
    } catch (evaluationError) {
      setError(apiErrorMessage(evaluationError, "Analiz başlatılamadı."));
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
      setError("Sınav ID zorunludur.");
      return;
    }
    if (!normalizedContentHash) {
      setError("Sonuç hash zorunludur.");
      return;
    }
    try {
      setReportJob(await enqueueReportGeneration(auth.accessToken, normalizedExamId, normalizedContentHash));
      await refreshReportSnapshots();
    } catch (reportError) {
      setError(apiErrorMessage(reportError, "Rapor üretimi kuyruğa alınamadı."));
    }
  }

  async function refreshReportSnapshots() {
    if (!auth) return;

    setError("");
    const normalizedExamId = examId.trim();
    if (!normalizedExamId) {
      setError("Sınav ID zorunludur.");
      return;
    }
    try {
      setReportSnapshots(await loadReportSnapshots(auth.accessToken, normalizedExamId));
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
      title="Optik Operasyon"
      subtitle="Cevap anahtarı, format onayı, optik yükleme ve karantina çözümünü aynı akışta yönet."
    >
      <section className="next-support-tools" aria-label="Sınav seçimi">
        <form className="next-support-tool" onSubmit={(event) => void submitCreateExam(event)}>
          <h2>Sınav</h2>
          <label>
            Sınav seç
            <select
              aria-label="Sınav seç"
              value={examId}
              onChange={(event) => {
                setExamId(event.target.value);
                setReportSnapshots([]);
                setReportJob(null);
              }}
            >
              {exams.length === 0 ? <option value="">Sınav yok</option> : null}
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </label>
          <p>{selectedExam ? `Seçili sınav ID: ${selectedExam.id}` : "Sınav seçilmedi"}</p>
          <label>
            Yeni sınav adı
            <Input value={newExamTitle} onChange={(event) => setNewExamTitle(event.target.value)} />
          </label>
          <label>
            Başlangıç
            <Input type="datetime-local" value={newExamStartsAt} onChange={(event) => setNewExamStartsAt(event.target.value)} />
          </label>
          <Button type="submit">
            <CheckCircle2 size={17} aria-hidden="true" />
            Sınav oluştur
          </Button>
        </form>
      </section>
      <section className="next-list-panel" aria-label="Optik operasyon">
        <div className="next-segmented" role="tablist" aria-label="Optik sekmeleri">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        {activeTab === "format" ? renderFormatTab() : null}
        {activeTab === "answer-key" ? renderAnswerKeyTab() : null}
        {activeTab === "upload" ? renderUploadTab() : null}
        {activeTab === "quarantine" ? renderQuarantineTab() : null}
      </section>
    </PageFrame>
  );

  function renderFormatTab() {
    return (
      <section className="next-support-tools" aria-label="Optik format">
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        <form className="next-support-tool next-support-tool--wide" onSubmit={(event) => void submitPresetSuggestion(event)}>
          <h2>TXT/DAT Formu</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            TXT/DAT şablonu
            <select
              aria-label="TXT/DAT şablonu"
              value={selectedPreset}
              onChange={(event) => setSelectedPreset(event.target.value as ParserConfigPreset)}
            >
              {opticalFormPresets.map((form) => (
                <option key={form.preset} value={form.preset}>
                  {form.name}
                </option>
              ))}
            </select>
          </label>
          <div className="next-optical-form-meta" aria-label="Seçili form özeti">
            <span>{selectedPresetForm.sourceType}</span>
            <span>{selectedPresetForm.rowLength} karakter</span>
            <span>{selectedPresetForm.questionCount} soru</span>
          </div>
          {renderOpticalFormPreview(selectedPresetForm.rows)}
          <Button disabled={!examId} type="submit">
            <CheckCircle2 size={17} aria-hidden="true" />
            Bu formu kullan
          </Button>
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitSuggestion(event)}>
          <h2>Optik Format</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            Örnek içerik
            <textarea
              required={!fileBase64}
              rows={5}
              value={sampleText}
              onChange={(event) => setSampleText(event.target.value)}
            />
          </label>
          <label>
            Dosya
            <Input accept=".txt,.dat,text/plain" type="file" onChange={(event) => void changeFile(event.target.files?.[0])} />
          </label>
          {fileName ? <p>{fileName}</p> : null}
          <Button type="submit">
            <FileText size={17} aria-hidden="true" />
            Analiz et
          </Button>
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitApproval(event)}>
          <h2>Parser Onayı</h2>
          <div className="next-parser-summary" aria-live="polite">
            {suggestion ? (
              <>
                <span>Ayraç</span>
                <strong>{suggestion.delimiter}</strong>
                <span>Başlık satırı</span>
                <strong>{suggestion.skipHeaderLines}</strong>
                <span>Güven</span>
                <strong>{suggestion.confidence}</strong>
                <span>Soru tahmini</span>
                <strong>{suggestion.fieldMapping.answers.estimatedQuestionCount}</strong>
              </>
            ) : (
              <strong>Bekliyor</strong>
            )}
          </div>
          <label>
            Versiyon
            <Input required value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
          <Button disabled={!suggestion} type="submit">
            <CheckCircle2 size={17} aria-hidden="true" />
            Onayla
          </Button>
          {savedConfig ? <p>{savedConfig.version} onaylandı</p> : null}
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitTemplateApply(event)}>
          <h2>Form Şablonu</h2>
          <label>
            Kayıtlı şablon
            <select
              aria-label="Kayıtlı optik form şablonu"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              {templates.length === 0 ? <option value="">Şablon yok</option> : null}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Parser versiyonu
            <Input required value={templateApplyVersion} onChange={(event) => setTemplateApplyVersion(event.target.value)} />
          </label>
          <Button disabled={!selectedTemplateId || !examId} type="submit">
            <CheckCircle2 size={17} aria-hidden="true" />
            Sınava uygula
          </Button>
          {selectedTemplate ? renderOpticalFormPreview(createTemplatePreviewRows(selectedTemplate)) : null}
          <div className="next-inline-form">
            <label>
              Yeni şablon adı
              <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </label>
            <label>
              Şablon versiyonu
              <Input value={templateVersion} onChange={(event) => setTemplateVersion(event.target.value)} />
            </label>
            <Button disabled={!suggestion} type="button" onClick={() => void submitTemplateCreate()}>
              <Upload size={17} aria-hidden="true" />
              Şablon kaydet
            </Button>
          </div>
        </form>
      </section>
    );
  }

  function renderAnswerKeyTab() {
    return (
      <section className="next-support-tools next-support-tools--wide" aria-label="Cevap anahtarı">
        <form className="next-support-tool" aria-label="Cevap anahtarı Excel import" onSubmit={(event) => void submitAnswerKeyDryRun(event)}>
          <h2>Cevap Anahtarı</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            Anahtar versiyonu
            <Input required value={answerKeyVersion} onChange={(event) => setAnswerKeyVersion(event.target.value)} />
          </label>
          <label>
            Cevap anahtarı dosyası
            <Input accept=".xlsx" type="file" onChange={(event) => void changeAnswerKeyFile(event.target.files?.[0])} />
          </label>
          {answerKeyFileName ? <p>{answerKeyFileName}</p> : null}
          <Button type="submit">
            <FileSpreadsheet size={17} aria-hidden="true" />
            Ön kontrol
          </Button>
          <Button disabled={!answerKeyDryRun} type="button" onClick={() => void submitAnswerKeyImport()}>
            <Upload size={17} aria-hidden="true" />
            İçe aktar
          </Button>
        </form>
        <section className="next-support-tool" aria-label="Cevap anahtarı özeti">
          <h2>Anahtar özeti</h2>
          {answerKeyDryRun ? (
            <>
              <p>{answerKeyDryRun.questionCount} soru doğrulandı.</p>
              <p>{answerKeyDryRun.bookletVariants.map((variant) => `${variant.code}: ${variant.questionCount} soru`).join(", ")}</p>
              <table className="uh-data-table">
                <thead>
                  <tr>
                    <th>Branş</th>
                    <th>Soru</th>
                  </tr>
                </thead>
                <tbody>
                  {answerKeyDryRun.branches.map((branch) => (
                    <tr key={branch.branch}>
                      <td>{branch.branch}</td>
                      <td>{branch.questionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>Excel dosyası ön kontrol bekliyor.</p>
          )}
          {answerKeyImport ? <p>{answerKeyImport.answerKey.version} içe aktarıldı.</p> : null}
        </section>
        <section className="next-support-tool next-support-tool--wide" aria-label="Manuel cevap anahtarı">
          <h2>Manuel 90 Satır Grid</h2>
          <div className="next-inline-form">
            <label>
              Sınav ID
              <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
            </label>
            <label>
              Manuel versiyon
              <Input required value={manualAnswerKeyVersion} onChange={(event) => setManualAnswerKeyVersion(event.target.value)} />
            </label>
            <label>
              Şık dizisi
              <Input
                aria-label="90 şık dizisi"
                value={manualAnswerText}
                onChange={(event) => setManualAnswerText(event.target.value)}
                placeholder="ABCDE..."
              />
            </label>
            <label>
              B kitapçık sırası
              <Input
                aria-label="B kitapçık sırası"
                value={manualBPermutationText}
                onChange={(event) => setManualBPermutationText(event.target.value)}
                placeholder="90 89 ... 1"
              />
            </label>
            <Button type="button" onClick={applyManualAnswerText}>
              Gridi doldur
            </Button>
          </div>
          <div className="next-grid-scroll">
            <table className="uh-data-table">
              <thead>
                <tr>
                  <th>Soru</th>
                  <th>Şık</th>
                  <th>Branş</th>
                  <th>Kazanım</th>
                  <th>Konu</th>
                </tr>
              </thead>
              <tbody>
                {manualQuestions.map((question) => (
                  <tr key={question.questionNo}>
                    <td>{question.questionNo}</td>
                    <td>
                      <select
                        aria-label={`${question.questionNo}. soru şıkkı`}
                        value={question.correctAnswer}
                        onChange={(event) =>
                          updateManualQuestion(question.questionNo, { correctAnswer: event.target.value as ManualAnswerChoice })
                        }
                      >
                        <option value="">Seç</option>
                        {answerChoices.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Input
                        aria-label={`${question.questionNo}. soru branşı`}
                        value={question.branch}
                        onChange={(event) => updateManualQuestion(question.questionNo, { branch: event.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        aria-label={`${question.questionNo}. soru kazanımı`}
                        value={question.outcomeCode}
                        onChange={(event) => updateManualQuestion(question.questionNo, { outcomeCode: event.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        aria-label={`${question.questionNo}. soru konusu`}
                        value={question.topic}
                        onChange={(event) => updateManualQuestion(question.questionNo, { topic: event.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="next-row-actions">
            <Button type="button" onClick={() => void submitManualAnswerKey(true)}>
              Ön kontrol
            </Button>
            <Button disabled={!manualDryRun} type="button" onClick={() => void submitManualAnswerKey(false)}>
              Kaydet
            </Button>
          </div>
          {manualDryRun ? (
            <p>
              {manualDryRun.questionCount} manuel soru doğrulandı.
              {manualDryRun.bookletVariants.length ? ` ${manualDryRun.bookletVariants.map((variant) => `${variant.code}: ${variant.questionCount} soru`).join(", ")}` : ""}
            </p>
          ) : null}
          {manualAnswerKey ? <p>{manualAnswerKey.version} manuel kaydedildi.</p> : null}
        </section>
      </section>
    );
  }

  function renderUploadTab() {
    return (
      <section className="next-support-tools" aria-label="Optik yükleme">
        <form className="next-support-tool" onSubmit={(event) => void submitRawImport(event)}>
          <h2>Optik Yükleme</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            Parser versiyonu
            <Input required value={rawImportParserVersion} onChange={(event) => setRawImportParserVersion(event.target.value)} />
          </label>
          <label>
            Optik cevap dosyası
            <Input accept=".txt,.dat,text/plain" type="file" onChange={(event) => void changeRawImportFile(event.target.files?.[0])} />
          </label>
          {rawImportFileName ? <p>{rawImportFileName}</p> : null}
          <Button type="submit">
            <Upload size={17} aria-hidden="true" />
            Yükle ve parse kuyruğa al
          </Button>
        </form>
        <section className="next-support-tool" aria-label="Optik yükleme sonucu">
          <h2>Yükleme sonucu</h2>
          {rawImport ? (
            <>
              <p>Raw import ID: {rawImport.rawImport.id}</p>
              <p>Parse job: {rawImport.parseJob.jobId}</p>
              <p>SHA256: {rawImport.rawImport.sha256.slice(0, 12)}</p>
              <div className="next-row-actions">
                <Button type="button" onClick={() => void refreshRawImportSummary()}>
                  <RefreshCw size={17} aria-hidden="true" />
                  Özeti yenile
                </Button>
                <Button type="button" onClick={() => void submitEvaluationJobs()}>
                  <Play size={17} aria-hidden="true" />
                  Analizi başlat
                </Button>
              </div>
            </>
          ) : (
            <p>Optik TXT/DAT dosyası bekliyor.</p>
          )}
          {rawImportSummary ? (
            <div className="next-parser-summary" aria-live="polite">
              <span>Toplam</span>
              <strong>{rawImportSummary.totalRows}</strong>
              <span>Eşleşen</span>
              <strong>{rawImportSummary.matchedCount}</strong>
              <span>Karantina</span>
              <strong>{rawImportSummary.quarantinedCount}</strong>
              <span>Sebep</span>
              <strong>{formatQuarantineReasons(rawImportSummary)}</strong>
            </div>
          ) : null}
          {evaluationJobs ? (
            <p>
              {evaluationJobs.queuedCount}/{evaluationJobs.matchedCount} analiz işi kuyruğa alındı.
            </p>
          ) : null}
        </section>
      </section>
    );
  }

  function renderQuarantineTab() {
    return (
      <section className="next-support-tools" aria-label="Karantina çözümü">
        <form className="next-support-tool" onSubmit={(event) => void submitQuarantineLookup(event)}>
          <h2>Karantina Çözümü</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            Raw import ID
            <Input required value={quarantineRawImportId} onChange={(event) => setQuarantineRawImportId(event.target.value)} />
          </label>
          <Button type="submit">
            <Wand2 size={17} aria-hidden="true" />
            Karantinaları getir
          </Button>
        </form>
        <section className="next-support-tool" aria-label="Karantina listesi">
          <h2>Karantina listesi</h2>
          <table className="uh-data-table">
            <thead>
              <tr>
                <th>Satır</th>
                <th>Sebep</th>
                <th>Durum</th>
                <th>Öğrenci</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {quarantines.map((record) => (
                <tr key={record.id}>
                  <td>{record.rowNumber}</td>
                  <td>{record.reason}</td>
                  <td>{record.status}</td>
                  <td>
                    <select
                      value={selectedStudentByQuarantine[record.id] ?? record.resolvedStudentId ?? ""}
                      onChange={(event) =>
                        setSelectedStudentByQuarantine((current) => ({ ...current, [record.id]: event.target.value }))
                      }
                    >
                      <option value="">Seçiniz</option>
                      {students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.firstName} {student.lastName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {record.status === "RESOLVED" ? (
                      record.evaluationJob ? `Kuyruk: ${record.evaluationJob.jobId}` : "Çözüldü"
                    ) : (
                      <button type="button" onClick={() => void resolveQuarantine(record)} aria-label={`${record.rowNumber}. satırı çöz`}>
                        <CheckCircle2 size={17} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {quarantines.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title="Karantina kaydı yok"
                      description="Raw import ID ile sorgu yaptığında eşleşmeyen optik satırlar burada listelenir."
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
        <form className="next-support-tool" aria-label="Optik rapor üretimi" onSubmit={(event) => void submitReportGeneration(event)}>
          <h2>Rapor Üretimi</h2>
          <label>
            Sınav ID
            <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label>
            Sonuç hash
            <Input required value={reportContentHash} onChange={(event) => setReportContentHash(event.target.value)} />
          </label>
          <Button type="submit">
            <RefreshCw size={17} aria-hidden="true" />
            Rapor üret
          </Button>
          <Button type="button" onClick={() => void refreshReportSnapshots()}>
            <FileText size={17} aria-hidden="true" />
            Raporları getir
          </Button>
          {reportJob ? <p>{reportJob.jobId} kuyruğa alındı.</p> : null}
        </form>
        <section className="next-support-tool" aria-label="Rapor listesi">
          <h2>Rapor listesi</h2>
          {reportSnapshots.length > 0 ? (
            <table className="uh-data-table">
              <thead>
                <tr>
                  <th>Durum</th>
                  <th>Sonuç</th>
                  <th>İndirme</th>
                </tr>
              </thead>
              <tbody>
                {reportSnapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td>{snapshot.status}</td>
                    <td>{snapshot.snapshotData?.resultCount ?? "-"}</td>
                    <td>
                      <div className="next-row-actions">
                        <button type="button" onClick={() => void downloadReportSnapshot(snapshot, "xlsx")} aria-label="Excel indir">
                          <Download size={17} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => void downloadReportSnapshot(snapshot, "pdf")} aria-label="PDF indir">
                          <FileText size={17} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>Hazır rapor yok</p>
          )}
        </section>
      </section>
    );
  }
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

async function loadQuarantines(accessToken: string, input: QuarantineLookupFormPayload) {
  return apiRequest<ImportQuarantineRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/quarantines`,
  );
}

async function loadStudents(accessToken: string) {
  return apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`);
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
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Bölüm</th>
            <th>Başlangıç</th>
            <th>Bitiş</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.section}-${row.start}-${row.end}`}>
              <td>{row.section}</td>
              <td>{row.start}</td>
              <td>{row.end}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      branch: defaultLgsBranch(questionNo),
      outcomeCode: "",
      topic: "",
    };
  });
}

function defaultLgsBranch(questionNo: number): string {
  if (questionNo <= 20) return "LGS TÜRKÇE";
  if (questionNo <= 30) return "LGS İNKILAP";
  if (questionNo <= 40) return "LGS DİN";
  if (questionNo <= 50) return "LGS İNGİLİZCE";
  if (questionNo <= 70) return "LGS MATEMATİK";
  return "LGS FEN";
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
