"use client";

import { type FormEvent, useState } from "react";
import { Button, EmptyState, Input } from "@uzman-hocam/ui";
import type { AnswerChoice, AnswerKeyRecord, ParserConfigSuggestion, StudentRecord } from "@uzman-hocam/shared-types";
import { CheckCircle2, FileSpreadsheet, FileText, RefreshCw, Upload, Wand2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import {
  answerKeyImportFormSchema,
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

export function ParserConfigPage() {
  const { auth } = useAuth();
  const [activeTab, setActiveTab] = useState<OpticalTab>("format");
  const [examId, setExamId] = useState("exam-demo-isem-lgs-1");
  const [version, setVersion] = useState("parser-v1");
  const [sampleText, setSampleText] = useState("ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [suggestion, setSuggestion] = useState<ParserConfigSuggestion | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedParserConfig | null>(null);
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
  const [quarantineRawImportId, setQuarantineRawImportId] = useState("");
  const [quarantines, setQuarantines] = useState<ImportQuarantineRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentByQuarantine, setSelectedStudentByQuarantine] = useState<Record<string, string>>({});
  const [reportContentHash, setReportContentHash] = useState("");
  const [reportJob, setReportJob] = useState<ReportGenerationQueueResult | null>(null);
  const [error, setError] = useState("");

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
    } catch {
      setError("Optik format önerisi alınamadı.");
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
    } catch {
      setError("Optik format onaylanamadı.");
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
    } catch {
      setError("Cevap anahtarı doğrulanamadı.");
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
    } catch {
      setError("Cevap anahtarı içe aktarılamadı.");
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
    } catch {
      setError(dryRun ? "Manuel cevap anahtarı doğrulanamadı." : "Manuel cevap anahtarı kaydedilemedi.");
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
      setQuarantineRawImportId(result.rawImport.id);
      setReportContentHash(result.rawImport.sha256);
      setReportJob(null);
      setActiveTab("quarantine");
    } catch {
      setError("Optik cevap dosyası yüklenemedi.");
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
    } catch {
      setError("Karantina kayıtları alınamadı.");
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
    } catch {
      setError("Karantina kaydı çözülemedi.");
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
    } catch {
      setError("Rapor üretimi kuyruğa alınamadı.");
    }
  }

  return (
    <PageFrame
      title="Optik Operasyon"
      subtitle="Cevap anahtarı, format onayı, optik yükleme ve karantina çözümünü aynı akışta yönet."
    >
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
            </>
          ) : (
            <p>Optik TXT/DAT dosyası bekliyor.</p>
          )}
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
          {reportJob ? <p>{reportJob.jobId} kuyruğa alındı.</p> : null}
        </form>
      </section>
    );
  }
}

async function suggestParserConfig(
  accessToken: string,
  examId: string,
  input: Pick<ParserConfigSuggestionFormPayload, "sampleText"> | Pick<ParserConfigSuggestionFormPayload, "fileBase64">,
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

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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
