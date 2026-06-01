"use client";

import { type FormEvent, useState } from "react";
import { Button, Input } from "@uzman-hocam/ui";
import type { ParserConfigSuggestion } from "@uzman-hocam/shared-types";
import { CheckCircle2, FileText } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import {
  firstFormError,
  parserConfigApprovalFormSchema,
  parserConfigSuggestionFormSchema,
  type ParserConfigSuggestionFormPayload,
} from "../../../../src/form-validation.js";

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

export function ParserConfigPage() {
  const { auth } = useAuth();
  const [examId, setExamId] = useState("exam-demo");
  const [version, setVersion] = useState("parser-v1");
  const [sampleText, setSampleText] = useState("ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [suggestion, setSuggestion] = useState<ParserConfigSuggestion | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedParserConfig | null>(null);
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

  return (
    <section className="next-support-tools" aria-label="Optik format">
      <form className="next-support-tool" onSubmit={(event) => void submitSuggestion(event)}>
        <h1>Optik Format</h1>
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
          <Input
            accept=".txt,.dat,text/plain"
            type="file"
            onChange={(event) => void changeFile(event.target.files?.[0])}
          />
        </label>
        {fileName ? <p>{fileName}</p> : null}
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
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

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
