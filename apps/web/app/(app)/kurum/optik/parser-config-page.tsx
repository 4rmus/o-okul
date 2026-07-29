"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Button, DataTable, EmptyState, Field, InfoGrid, InfoItem, Input, MetricCard, MetricGrid, Panel, Select, StatusBadge, TabButton, Tabs, type DataTableColumn } from "@o-okul/ui";
import type {
  ExamRecord,
  OpticalFormTemplateRecord,
  ParserConfigPreset,
  ParserConfigSuggestion,
  StudentRecord,
} from "@o-okul/shared-types";
import { CheckCircle2, FileText, Play, RefreshCw, Search, Upload, Wand2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import {
  firstFormError,
  parserConfigApprovalFormSchema,
  parserConfigSuggestionFormSchema,
  quarantineLookupFormSchema,
  quarantineResolveFormSchema,
  rawImportUploadFormSchema,
  type ParserConfigSuggestionFormPayload,
  type QuarantineLookupFormPayload,
  type RawImportUploadFormPayload,
} from "../../../../src/form-validation.js";

type OpticalTab = "format" | "upload" | "quarantine";

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

interface ImportQuarantineResolveBulkResponse {
  results: Array<{
    errorCode?: string;
    quarantine?: ImportQuarantineRecord;
    quarantineId: string;
    status: "RESOLVED" | "FAILED";
  }>;
}

const tabs: Array<{ id: OpticalTab; label: string }> = [
  { id: "format", label: "1. Format" },
  { id: "upload", label: "2. Optik yükleme" },
  { id: "quarantine", label: "3. Eşleşmeyen satırlar" },
];

const defaultOpticalTab: OpticalTab = "format";

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
  questionCount?: number;
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
  {
    preset: "OPTIK_129",
    name: "OPTİK FORM 129",
    sourceType: "TXT/DAT",
    rowLength: 223,
    rows: [
      { section: "TC KİMLİK NO", start: "37", end: "47" },
      { section: "OKUL NO", start: "12", end: "16" },
      { section: "KİTAPÇIK TÜRÜ", start: "56", end: "56" },
      { section: "AD SOYAD", start: "17", end: "36" },
      { section: "TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", start: "57", end: "96" },
      { section: "SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", start: "97", end: "142" },
      { section: "MATEMATİK", start: "143", end: "182" },
      { section: "FEN BİLİMLERİ", start: "183", end: "223" },
    ],
  },
  {
    preset: "YANIT",
    name: "YANIT YAYINLARI",
    sourceType: "TXT/DAT",
    rowLength: 233,
    rows: [
      { section: "TC KİMLİK NO", start: "13", end: "23" },
      { section: "OKUL NO", start: "7", end: "12" },
      { section: "KİTAPÇIK TÜRÜ", start: "49", end: "49" },
      { section: "AD SOYAD", start: "24", end: "43" },
      { section: "TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", start: "50", end: "95" },
      { section: "SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", start: "96", end: "141" },
      { section: "MATEMATİK", start: "142", end: "187" },
      { section: "FEN BİLİMLERİ", start: "188", end: "233" },
    ],
  },
  {
    preset: "OPTIK_840_LGS",
    name: "OPTİK 840 — LGS",
    sourceType: "TXT/DAT",
    rowLength: 280,
    questionCount: 90,
    rows: [
      { section: "TC KİMLİK NO", start: "35", end: "45" },
      { section: "OKUL NO", start: "10", end: "14" },
      { section: "KİTAPÇIK TÜRÜ", start: "60", end: "60" },
      { section: "AD SOYAD", start: "15", end: "34" },
      { section: "TÜRKÇE", start: "161", end: "180" },
      { section: "SOSYAL BİLGİLER / T.C. İNKILAP TARİHİ VE ATATÜRKÇÜLÜK", start: "181", end: "200" },
      { section: "DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", start: "201", end: "220" },
      { section: "İNGİLİZCE", start: "221", end: "240" },
      { section: "MATEMATİK", start: "241", end: "260" },
      { section: "FEN BİLİMLERİ", start: "261", end: "280" },
    ],
  },
];

type OpticalFormPreset = (typeof opticalFormPresets)[number];
const defaultParserConfigVersion = createPresetParserVersion(opticalFormPresets[0]!);

function createPresetParserVersion(form: OpticalFormPreset) {
  const slug = slugifyVersionPart(form.name);
  return `${slug}-v1`;
}

function formatPresetQuestionCount(form: OpticalFormPreset, examType: string | undefined) {
  if (form.preset === "OPTIK_129" || form.preset === "YANIT") {
    if (examType === "TYT") return "120 soru";
    if (examType === "AYT") return "160 soru";
    return "TYT 120 / AYT 160";
  }
  return `${form.questionCount} soru`;
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

function formatSelectedFileNotice(fileName: string) {
  const extension = fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  return extension ? `${extension} dosyası seçildi` : "Dosya seçildi";
}

function formatEvidenceSafeReference(value: string | undefined, label: string) {
  return value?.trim() ? `${label}: maskeli` : `${label}: yok`;
}

function readOpticalTab(searchParams: Pick<URLSearchParams, "get">): OpticalTab {
  const tab = searchParams.get("tab");
  return tabs.some((candidate) => candidate.id === tab) ? tab as OpticalTab : defaultOpticalTab;
}

function writeOpticalWorkspaceToUrl(input: { examId: string; tab: OpticalTab }) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (input.examId) {
    url.searchParams.set("examId", input.examId);
  } else {
    url.searchParams.delete("examId");
  }
  if (input.tab === defaultOpticalTab) {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", input.tab);
  }
  window.history.replaceState(window.history.state, "", formatUrlForReplaceState(url));
}

function formatUrlForReplaceState(url: URL) {
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

export function ParserConfigPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [activeTab, setActiveTab] = useState<OpticalTab>(() => readOpticalTab(searchParams));
  const [examId, setExamId] = useState(() => searchParams.get("examId") ?? "");
  const [exams, setExams] = useState<ExamRecord[]>([]);
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
  const [quarantineStudentOptions, setQuarantineStudentOptions] = useState<StudentRecord[]>([]);
  const [quarantineStudentQuery, setQuarantineStudentQuery] = useState("");
  const [isQuarantineStudentSearching, setIsQuarantineStudentSearching] = useState(false);
  const [selectedStudentByQuarantine, setSelectedStudentByQuarantine] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const selectedExam = exams.find((exam) => exam.id === examId);
  const selectedPresetForm = opticalFormPresets.find((form) => form.preset === selectedPreset) ?? opticalFormPresets[0]!;
  const selectedPresetVersion = createPresetParserVersion(selectedPresetForm);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const formatStatusLabel = savedConfig ? "Format hazır" : suggestion ? "Öneri hazır" : "Format bekliyor";
  const formatStatusTone = savedConfig ? "success" : suggestion ? "info" : "neutral";
  const uploadStatusLabel = rawImportSummary
    ? "Kontrol tamamlandı"
    : rawImport
      ? "Kontrol bekliyor"
      : rawImportFileName
        ? "Dosya seçildi"
        : "Dosya bekliyor";
  const uploadStatusTone = rawImportSummary ? "success" : rawImport || rawImportFileName ? "warning" : "neutral";
  const analysisStatusLabel = evaluationStatus?.status === "COMPLETED"
    ? "Tamamlandı"
    : evaluationJobs
      ? "Kuyrukta"
      : rawImportSummary
        ? "Analiz bekliyor"
        : "Yükleme bekliyor";
  const analysisStatusTone = evaluationStatus?.status === "COMPLETED" ? "success" : evaluationJobs || rawImportSummary ? "warning" : "neutral";
  const outputStatusLabel = evaluationStatus?.status === "COMPLETED" ? "Raporlara geç" : "Analiz bekliyor";
  const outputStatusTone = evaluationStatus?.status === "COMPLETED" ? "info" : "neutral";

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
    const nextTab = readOpticalTab(searchParams);
    const nextExamId = searchParams.get("examId") ?? "";
    setActiveTab((current) => (current === nextTab ? current : nextTab));
    if (nextExamId) {
      setExamId((current) => (current === nextExamId ? current : nextExamId));
    }
  }, [searchParams, searchParamsKey]);

  function selectOpticalTab(tab: OpticalTab, nextExamId = examId) {
    setActiveTab(tab);
    writeOpticalWorkspaceToUrl({ examId: nextExamId, tab });
  }

  function selectOpticalExam(nextExamId: string) {
    setExamId(nextExamId);
    setSuggestion(null);
    setSavedConfig(null);
    setFileName("");
    setFileBase64("");
    setRawImportFileName("");
    setRawImportFileBase64("");
    setRawImport(null);
    setRawImportSummary(null);
    setEvaluationJobs(null);
    setEvaluationStatus(null);
    setIsRawImportSubmitting(false);
    setIsRawImportChecking(false);
    setIsEvaluationSubmitting(false);
    setQuarantineRawImportId("");
    setQuarantines([]);
    setQuarantineStudentOptions([]);
    setQuarantineStudentQuery("");
    setIsQuarantineStudentSearching(false);
    setSelectedStudentByQuarantine({});
    setError("");
    writeOpticalWorkspaceToUrl({ examId: nextExamId, tab: activeTab });
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
      selectOpticalTab("upload", result.examId);
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
      setError("Sınav seçilmelidir.");
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
      selectOpticalTab("upload", result.examId);
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
    setQuarantineStudentOptions([]);
    setSelectedStudentByQuarantine({});
    setIsRawImportChecking(true);
    try {
      setRawImportSummary(await waitForRawImportSummary(auth.accessToken, examId, result.rawImport.id));
      const records = await loadQuarantines(auth.accessToken, { examId, rawImportId: result.rawImport.id });
      setQuarantines(records);
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
      const jobs = await enqueueRawImportEvaluation(auth.accessToken, {
        examId,
        rawImportId,
      });
      setEvaluationJobs(jobs);
      const status = await waitForRawImportEvaluationStatus(auth.accessToken, {
        examId,
        rawImportId,
        answerKeyId: jobs.answerKeyId,
        expectedCount: jobs.queuedCount,
      });
      setEvaluationStatus(status);
      selectOpticalTab("quarantine");
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
      const records = await loadQuarantines(auth.accessToken, parsedForm.data);
      setQuarantines(records);
      setQuarantineStudentOptions([]);
      setSelectedStudentByQuarantine({});
    } catch (lookupError) {
      setError(apiErrorMessage(lookupError, "Karantina kayıtları alınamadı."));
    }
  }

  async function submitQuarantineStudentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const query = quarantineStudentQuery.trim();
    if (query.length < 2) {
      setError("Öğrenci araması için en az 2 karakter girin.");
      return;
    }
    setIsQuarantineStudentSearching(true);
    try {
      setQuarantineStudentOptions(await loadStudents(auth.accessToken, { limit: 10, q: query }));
    } catch (searchError) {
      setError(apiErrorMessage(searchError, "Öğrenci araması yapılamadı."));
    } finally {
      setIsQuarantineStudentSearching(false);
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

  async function resolveSelectedQuarantines() {
    if (!auth) return;

    const rawImportId = (rawImport?.rawImport.id ?? quarantineRawImportId).trim();
    const items = quarantines
      .filter((record) => record.status !== "RESOLVED")
      .map((record) => ({
        quarantineId: record.id,
        resolvedStudentId: selectedStudentByQuarantine[record.id] ?? "",
      }))
      .filter((item) => item.resolvedStudentId);
    if (!rawImportId || items.length === 0) {
      setError("Bulk çözüm için öğrenci seçilmiş açık satır bulunamadı.");
      return;
    }

    setError("");
    try {
      const response = await resolveImportQuarantinesBulk(auth.accessToken, {
        examId,
        rawImportId,
        items,
      });
      const resolvedById = new Map(response.results.flatMap((result) => result.quarantine ? [[result.quarantineId, result.quarantine]] : []));
      setQuarantines((current) => current.map((item) => resolvedById.get(item.id) ?? item));
      const failedCount = response.results.filter((result) => result.status === "FAILED").length;
      if (failedCount > 0) {
        setError(`${failedCount} karantina satırı çözülemedi.`);
      }
    } catch (resolveError) {
      setError(apiErrorMessage(resolveError, "Karantina satırları bulk çözülemedi."));
    }
  }

  return (
    <PageFrame
      title="Optik İşlemleri"
      subtitle="Cevap anahtarı hazır sınavı seç, optik formatı kaydet ve TXT/DAT yüklemesini tek akışta kontrol et."
    >
      <OpticalExamSelector
        examId={examId}
        exams={exams}
        selectedExam={selectedExam}
        onExamChange={selectOpticalExam}
      />
      <Panel
        aria-label="Optik operasyon"
        className="next-optical-workspace"
        description="Cevap anahtarı sınav oluşturulurken hazırlanır; bu ekran format, optik yükleme ve eşleşmeyen satır çözümünü yürütür."
        title="Optik Operasyon Akışı"
      >
        <InfoGrid aria-label="Optik iş akışı" className="next-optical-workflow-strip" role="region">
          <InfoItem
            description="Form şablonu ve parser sürümü"
            label="Format"
            value={<StatusBadge tone={formatStatusTone}>{formatStatusLabel}</StatusBadge>}
          />
          <InfoItem
            description="TXT/DAT kontrol sonucu"
            label="Yükleme"
            value={<StatusBadge tone={uploadStatusTone}>{uploadStatusLabel}</StatusBadge>}
          />
          <InfoItem
            description="Queue ile tamamlanma ayrımı"
            label="Analiz"
            value={<StatusBadge tone={analysisStatusTone}>{analysisStatusLabel}</StatusBadge>}
          />
          <InfoItem
            description="Üretim ve çıktılar Raporlar ekranında"
            label="Çıktı"
            value={<StatusBadge tone={outputStatusTone}>{outputStatusLabel}</StatusBadge>}
          />
        </InfoGrid>
        <Tabs label="Optik sekmeleri" className="next-optical-tabs">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              aria-controls={activeTab === tab.id ? `optical-panel-${tab.id}` : undefined}
              id={`optical-tab-${tab.id}`}
              selected={activeTab === tab.id}
              onClick={() => selectOpticalTab(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
        </Tabs>
        {error ? <p className="uh-crud-page__error" role="alert">{error}</p> : null}
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
            examType={selectedExam?.examType}
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
          <section className="next-optical-report-workspace" aria-label="Eşleşmeyen satırlar">
            <QuarantineResolutionPanel
              quarantineRawImportId={quarantineRawImportId}
              quarantines={quarantines}
              selectedStudentByQuarantine={selectedStudentByQuarantine}
              students={quarantineStudentOptions}
              studentSearchQuery={quarantineStudentQuery}
              isStudentSearchSubmitting={isQuarantineStudentSearching}
              onLookupSubmit={submitQuarantineLookup}
              onQuarantineRawImportIdChange={setQuarantineRawImportId}
              onResolve={resolveQuarantine}
              onResolveBulk={resolveSelectedQuarantines}
              onSelectedStudentChange={setSelectedStudentByQuarantine}
              onStudentSearchQueryChange={setQuarantineStudentQuery}
              onStudentSearchSubmit={submitQuarantineStudentSearch}
            />
          </section>
        ) : null}
        <OpticalReportPanel
          evaluationStatus={evaluationStatus}
          examId={examId}
        />
        </div>
      </Panel>
    </PageFrame>
  );
}

interface OpticalExamSelectorProps {
  examId: string;
  exams: ExamRecord[];
  selectedExam?: ExamRecord;
  onExamChange: (value: string) => void;
}

function OpticalExamSelector({
  examId,
  exams,
  selectedExam,
  onExamChange,
}: OpticalExamSelectorProps) {
  return (
    <section className="next-optical-selector-grid" aria-label="Sınav seçimi">
      <Panel
        aria-label="Sınav seç"
        className="next-optical-selector-panel"
        description="Cevap anahtarı hazırlanmış sınavı seç. Yeni sınav ve cevap anahtarı Sınavlar ekranında oluşturulur."
        title="Sınav seç"
      >
        <Field label="Sınav seç">
          <Select value={examId} onChange={(event) => onExamChange(event.target.value)}>
            <option value="">Sınav seç</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </Select>
        </Field>
        {selectedExam ? <p>{`Seçili sınav: ${selectedExam.title}`}</p> : null}
        {!selectedExam ? <p>Sınav ve cevap anahtarı hazırlandıktan sonra optik yükleme burada başlar.</p> : null}
      </Panel>
    </section>
  );
}

interface OpticalFormatSetupProps {
  examId: string;
  examType?: string;
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
  examType,
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
          <InfoItem label="Soru" value={formatPresetQuestionCount(selectedPresetForm, examType)} />
          <InfoItem label="Sürüm" value={selectedPresetVersion} />
        </InfoGrid>
        {selectedPreset !== "OPTIK_7108_LGS" ? (
          <Alert tone="warning" title="Gerçek TXT/DAT örneği bekleniyor">
            Bu preset referans görsel kolonlarından türetildi; gerçek üretici TXT/DAT dosyasıyla henüz doğrulanmadı.
            Kullanıcı bunu bilerek seçiyor. Tablo fiziksel kolon kapasitesini, soru sayısı seçilen modda okunan
            mantıksal cevapları gösterir.
          </Alert>
        ) : null}
        {renderOpticalFormPreview(selectedPresetForm.rows)}
        <InfoGrid aria-live="polite" className="next-parser-summary" role="status">
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
          <InfoGrid aria-live="polite" className="next-parser-summary" role="status">
            <InfoItem label="Toplam" value={rawImportSummary.totalRows} />
            <InfoItem label="Eşleşen" value={rawImportSummary.matchedCount} />
            <InfoItem label="Eşleşmeyen" value={rawImportSummary.quarantinedCount} />
            <InfoItem label="Sebep" value={formatQuarantineReasons(rawImportSummary)} />
          </InfoGrid>
        ) : null}
        {evaluationJobs ? (
          <p aria-live="polite" role="status">
            {evaluationJobs.queuedCount}/{evaluationJobs.matchedCount} analiz işi kuyruğa alındı.
            {isEvaluationSubmitting ? " Sonuçlar bekleniyor." : ""}
          </p>
        ) : null}
        {evaluationStatus ? (
          <p aria-live="polite" role="status">
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
  isStudentSearchSubmitting: boolean;
  selectedStudentByQuarantine: Record<string, string>;
  studentSearchQuery: string;
  students: StudentRecord[];
  onLookupSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQuarantineRawImportIdChange: (value: string) => void;
  onResolve: (record: ImportQuarantineRecord) => void | Promise<void>;
  onResolveBulk: () => void | Promise<void>;
  onSelectedStudentChange: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onStudentSearchQueryChange: (value: string) => void;
  onStudentSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function QuarantineResolutionPanel({
  quarantineRawImportId,
  quarantines,
  isStudentSearchSubmitting,
  selectedStudentByQuarantine,
  studentSearchQuery,
  students,
  onLookupSubmit,
  onQuarantineRawImportIdChange,
  onResolve,
  onResolveBulk,
  onSelectedStudentChange,
  onStudentSearchQueryChange,
  onStudentSearchSubmit,
}: QuarantineResolutionPanelProps) {
  const studentSelectOptions = useMemo(
    () =>
      students.map((student) => (
        <option key={student.id} value={student.id}>
          {student.firstName} {student.lastName}
        </option>
      )),
    [students],
  );
  const bulkResolvableCount = quarantines.filter((record) =>
    record.status !== "RESOLVED" && Boolean(selectedStudentByQuarantine[record.id]),
  ).length;
  const quarantineColumns = useMemo<Array<DataTableColumn<ImportQuarantineRecord>>>(
    () => [
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
            {studentSelectOptions}
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
    ],
    [onResolve, onSelectedStudentChange, selectedStudentByQuarantine, studentSelectOptions],
  );

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
        <form className="next-inline-form" onSubmit={(event) => void onStudentSearchSubmit(event)}>
          <Field label="Öğrenci adı/no ara">
            <Input value={studentSearchQuery} onChange={(event) => onStudentSearchQueryChange(event.target.value)} />
          </Field>
          <Button type="submit" disabled={isStudentSearchSubmitting}>
            <Search size={17} aria-hidden="true" />
            Öğrencileri ara
          </Button>
        </form>
        <div className="next-inline-form" role="group" aria-label="Bulk karantina çözümü">
          <Button type="button" disabled={bulkResolvableCount === 0} onClick={() => void onResolveBulk()}>
            <CheckCircle2 size={17} aria-hidden="true" />
            Seçili satırları çöz
          </Button>
          <span className="next-status-note">{bulkResolvableCount} satır hazır</span>
        </div>
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
  examId: string;
}

function OpticalReportPanel({
  evaluationStatus,
  examId,
}: OpticalReportPanelProps) {
  const reportMessage = getReportReadinessMessage(evaluationStatus);
  const isReportReady = evaluationStatus?.status === "COMPLETED" && evaluationStatus.evaluatedCount > 0;

  return (
    <Panel
      aria-label="Raporlara geçiş"
      className="next-optical-report-panel next-optical-report-panel--wide"
      description={`${reportMessage} Analiz, öğrenci sonuçları ve çıktılar Raporlar çalışma alanında yönetilir.`}
      title="Raporlara geçiş"
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
      </MetricGrid>
      <section className="next-optical-next-step" aria-label="Optik sonraki adımı">
        <div>
          <strong>Sonraki adım: raporu doğrulayın</strong>
          <span>{reportMessage}</span>
        </div>
        {isReportReady ? (
          <Link className="uh-button uh-button--primary uh-button--md" href={`/kurum/raporlar?examId=${encodeURIComponent(examId)}`}>
            Rapor çalışma alanına geç
          </Link>
        ) : (
          <Button disabled type="button" variant="secondary">
            Analiz tamamlanınca açılır
          </Button>
        )}
      </section>
    </Panel>
  );
}

function getReportReadinessMessage(evaluationStatus: RawImportEvaluationStatus | null): string {
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

async function loadStudents(accessToken: string, input: { classId?: string; limit?: number; q?: string } = {}) {
  const query = new URLSearchParams();
  if (input.classId?.trim()) query.set("classId", input.classId.trim());
  if (input.q?.trim()) query.set("q", input.q.trim());
  if (input.limit) query.set("limit", String(input.limit));
  const queryString = query.toString();
  return apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students${queryString ? `?${queryString}` : ""}`);
}

function createClientIdempotencyKey(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
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

async function resolveImportQuarantinesBulk(
  accessToken: string,
  input: { examId: string; rawImportId: string; items: Array<{ quarantineId: string; resolvedStudentId: string }> },
) {
  return apiRequest<ImportQuarantineResolveBulkResponse>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(input.examId)}/raw-imports/${encodeURIComponent(input.rawImportId)}/quarantines/resolve-bulk`,
    {
      body: JSON.stringify({ items: input.items }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": createClientIdempotencyKey("raw-import-quarantine-bulk"),
      },
      method: "POST",
    },
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
