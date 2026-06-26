"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AcademicYearRecord,
  ClassRecord,
  CourseRecord,
  StudentImportDryRunResult,
  StudentImportResult,
  TeacherImportDryRunResult,
  TeacherImportResult,
} from "@o-okul/shared-types";
import { Button, Checkbox, Field, Input, MetricCard, MetricGrid, Panel, SegmentedControl, Select, StatusBadge, TabButton, Tabs } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, queryClient } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";

type StepId = "general" | "term" | "courses" | "classes" | "people";
type StageId = "7" | "8-LGS" | "10" | "11" | "12" | "TYT/AYT";
type SetupImportFileExtension = "CSV" | "XLSX";
type SetupUploadStatusState = "idle" | "ready" | "error";

interface SetupUploadStatus {
  badge: string;
  detail: string;
  meta: string;
  state: SetupUploadStatusState;
  title: string;
  tone: "info" | "success" | "danger";
}

interface OnboardingDraft {
  classes: {
    classCounts: Record<StageId, string>;
  };
  courses: {
    selectedCourseIds: string[];
  };
  general: {
    contactEmail: string;
    institutionName: string;
    institutionType: "course-center" | "school" | "study-center";
    logoUrl: string;
  };
  people: {
    importOwner: string;
    inviteGuardians: boolean;
    inviteTeachers: boolean;
    studentImportFileName: string;
    studentModel: "manual" | "excel";
    teacherImportFileName: string;
    teacherModel: "manual" | "excel";
  };
  term: {
    academicYearName: string;
    endsAt: string;
    startsAt: string;
    termEndsAt: string;
    termName: string;
    termStartsAt: string;
  };
}

type StepErrors = Record<string, string>;

interface TenantProfileRecord {
  contactEmail?: string;
  id: string;
  institutionType?: string;
  logoUrl?: string;
  name: string;
}

const steps: Array<{ id: StepId; kicker: string; title: string; description: string }> = [
  {
    id: "general",
    kicker: "1. Adım",
    title: "Kurum Genel Bilgileri",
    description: "Kurum adı, türü ve marka bilgisi.",
  },
  {
    id: "term",
    kicker: "2. Adım",
    title: "Akademik Dönem Ayarları",
    description: "Yıl ve aktif dönem tarihleri.",
  },
  {
    id: "classes",
    kicker: "3. Adım",
    title: "Sınıf ve Şubeler",
    description: "Kademe ve sınıf sayısına göre şubeleri otomatik oluştur.",
  },
  {
    id: "courses",
    kicker: "4. Adım",
    title: "Derslerin Oluşturulması",
    description: "LGS ve TYT/AYT derslerini tıklayarak seç.",
  },
  {
    id: "people",
    kicker: "5. Adım",
    title: "Kişi Yönetim Altyapısı",
    description: "Öğretmen ve öğrenci veri giriş modeli.",
  },
];

const initialDraft: OnboardingDraft = {
  classes: {
    classCounts: {
      "7": "0",
      "8-LGS": "2",
      "10": "0",
      "11": "0",
      "12": "0",
      "TYT/AYT": "0",
    },
  },
  courses: {
    selectedCourseIds: ["8-lgs-turkce", "8-lgs-matematik", "8-lgs-fen"],
  },
  general: {
    contactEmail: "",
    institutionName: "",
    institutionType: "course-center",
    logoUrl: "",
  },
  people: {
    importOwner: "",
    inviteGuardians: true,
    inviteTeachers: true,
    studentImportFileName: "",
    studentModel: "excel",
    teacherImportFileName: "",
    teacherModel: "manual",
  },
  term: {
    academicYearName: "2026-2027",
    endsAt: "2027-06-19",
    startsAt: "2026-09-01",
    termEndsAt: "2027-01-16",
    termName: "1. Dönem",
    termStartsAt: "2026-09-01",
  },
};

const stageOptions: Array<{ id: StageId; label: string }> = [
  { id: "7", label: "7. sınıf" },
  { id: "8-LGS", label: "8. sınıf / LGS" },
  { id: "10", label: "10. sınıf" },
  { id: "11", label: "11. sınıf" },
  { id: "12", label: "12. sınıf" },
  { id: "TYT/AYT", label: "TYT/AYT" },
];

const courseGroups: Array<{ title: string; source: string; courses: Array<{ id: string; name: string; code: string }> }> = [
  {
    title: "7. sınıflar",
    source: "Ortaokul temel dersleri",
    courses: [
      { id: "7-turkce", name: "Türkçe", code: "7-TUR" },
      { id: "7-matematik", name: "Matematik", code: "7-MAT" },
      { id: "7-fen", name: "Fen Bilgisi", code: "7-FEN" },
      { id: "7-sosyal", name: "Sosyal Bilgiler", code: "7-SOS" },
      { id: "7-ingilizce", name: "Yabancı Dil (İngilizce)", code: "7-ING" },
      { id: "7-din", name: "Din Kültürü", code: "7-DIN" },
    ],
  },
  {
    title: "8. sınıflar / LGS",
    source: "LGS sınavı hazırlık dersleri",
    courses: [
      { id: "8-lgs-turkce", name: "Türkçe", code: "LGS-TUR" },
      { id: "8-lgs-matematik", name: "Matematik", code: "LGS-MAT" },
      { id: "8-lgs-fen", name: "Fen Bilgisi", code: "LGS-FEN" },
      { id: "8-lgs-inkilap", name: "Atatürk İlke ve İnkılapları", code: "LGS-INK" },
      { id: "8-lgs-ingilizce", name: "Yabancı Dil (İngilizce)", code: "LGS-ING" },
      { id: "8-lgs-din", name: "Din Kültürü", code: "LGS-DIN" },
    ],
  },
  {
    title: "10. sınıflar",
    source: "Lise ortak dersleri",
    courses: [
      { id: "10-edebiyat", name: "Türk Dili ve Edebiyatı", code: "10-EDE" },
      { id: "10-matematik", name: "Matematik", code: "10-MAT" },
      { id: "10-fizik", name: "Fizik", code: "10-FIZ" },
      { id: "10-kimya", name: "Kimya", code: "10-KIM" },
      { id: "10-biyoloji", name: "Biyoloji", code: "10-BIY" },
      { id: "10-tarih", name: "Tarih", code: "10-TAR" },
      { id: "10-cografya", name: "Coğrafya", code: "10-COG" },
      { id: "10-felsefe", name: "Felsefe", code: "10-FEL" },
      { id: "10-din", name: "Din Kültürü ve Ahlak Bilgisi", code: "10-DIN" },
      { id: "10-ingilizce", name: "Yabancı Dil (İngilizce)", code: "10-ING" },
    ],
  },
  {
    title: "11, 12 ve TYT/AYT",
    source: "Alan gruplarına göre sınav hazırlık dersleri",
    courses: [
      { id: "ayt-temel-matematik", name: "Temel Matematik", code: "AYT-TMAT" },
      { id: "ayt-geometri", name: "Geometri", code: "AYT-GEO" },
      { id: "ayt-fizik", name: "Fizik", code: "AYT-FIZ" },
      { id: "ayt-kimya", name: "Kimya", code: "AYT-KIM" },
      { id: "ayt-biyoloji", name: "Biyoloji", code: "AYT-BIY" },
      { id: "ayt-edebiyat", name: "Türk Dili ve Edebiyatı", code: "AYT-EDE" },
      { id: "ayt-tarih", name: "Tarih", code: "AYT-TAR" },
      { id: "ayt-cografya", name: "Coğrafya", code: "AYT-COG" },
      { id: "ayt-felsefe", name: "Felsefe grubu", code: "AYT-FEL" },
      { id: "ayt-sosyoloji", name: "Sosyoloji", code: "AYT-SOZ" },
      { id: "ayt-psikoloji", name: "Psikoloji", code: "AYT-PSI" },
      { id: "ayt-mantik", name: "Mantık", code: "AYT-MAN" },
      { id: "ydt-ingilizce", name: "İleri Yabancı Dil (İngilizce)", code: "YDT-ING" },
      { id: "ydt-almanca", name: "İleri Yabancı Dil (Almanca)", code: "YDT-ALM" },
    ],
  },
];

const allCourseOptions = courseGroups.flatMap((group) => group.courses);
const setupImportMaxBytes = 5 * 1024 * 1024;
const setupImportAllowedExtensions = new Set<SetupImportFileExtension>(["CSV", "XLSX"]);

export function SetupWizard() {
  const { auth } = useAuth();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const draftStorageKey = `uh_onboarding_${tenantId}_draft`;
  const completedCookieName = `uh_onboarding_${encodeURIComponent(tenantId)}_completed`;
  const [activeStepId, setActiveStepId] = useState<StepId>("general");
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const [errors, setErrors] = useState<StepErrors>({});
  const [isFinished, setIsFinished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedSummary, setSavedSummary] = useState("");
  const [studentImportFileBase64, setStudentImportFileBase64] = useState("");
  const [teacherImportFileBase64, setTeacherImportFileBase64] = useState("");
  const [studentImportUploadStatus, setStudentImportUploadStatus] = useState<SetupUploadStatus>(() =>
    createIdleUploadStatus(),
  );
  const [teacherImportUploadStatus, setTeacherImportUploadStatus] = useState<SetupUploadStatus>(() =>
    createIdleUploadStatus(),
  );
  const [loadedDraftKey, setLoadedDraftKey] = useState("");
  const tenantProfileQuery = useQuery({
    queryKey: ["next-current-tenant", tenantId],
    queryFn: () => loadCurrentTenant(auth?.accessToken ?? ""),
    enabled: Boolean(auth?.accessToken),
  });
  const activeStepIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepId));
  const activeStep = steps[activeStepIndex]!;
  const stepValidation = useMemo(
    () => new Map(steps.map((step) => [step.id, validateStep(step.id, draft)])),
    [draft],
  );
  const completedStepCount = steps.filter((step) => Object.keys(stepValidation.get(step.id) ?? {}).length === 0).length;
  const progressPercent = Math.round((completedStepCount / steps.length) * 100);
  const selectedCourses = selectedCourseOptions(draft.courses.selectedCourseIds);
  const generatedClasses = generateClasses(draft.classes.classCounts);
  const courseCount = selectedCourses.length;
  const classCount = generatedClasses.length;

  useEffect(() => {
    if (!auth || typeof window === "undefined") return;
    const storedDraft = readDraftFromSession(draftStorageKey);
    if (storedDraft) {
      setDraft(mergeDraft(storedDraft));
    } else {
      setDraft(initialDraft);
    }
    setIsFinished(readCookie(completedCookieName) === "true");
    setLoadedDraftKey(draftStorageKey);
  }, [auth, completedCookieName, draftStorageKey]);

  useEffect(() => {
    if (!auth || loadedDraftKey !== draftStorageKey || typeof window === "undefined") return;
    writeDraftToSession(draftStorageKey, sanitizeDraftForStorage(draft));
  }, [auth, draft, draftStorageKey, loadedDraftKey]);

  useEffect(() => {
    if (loadedDraftKey !== draftStorageKey || !tenantProfileQuery.data) return;
    setDraft((current) => mergeTenantProfileDraft(current, tenantProfileQuery.data!));
  }, [draftStorageKey, loadedDraftKey, tenantProfileQuery.data]);

  function updateDraft(section: keyof OnboardingDraft, nextValue: Partial<OnboardingDraft[typeof section]>) {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...nextValue,
      },
    }));
  }

  function goToStep(stepId: StepId) {
    setActiveStepId(stepId);
    setErrors({});
  }

  function goNext() {
    const nextErrors = validateStep(activeStep.id, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const nextStep = steps[activeStepIndex + 1];
    if (nextStep) {
      setActiveStepId(nextStep.id);
      setErrors({});
    }
  }

  function goBack() {
    const previousStep = steps[activeStepIndex - 1];
    if (!previousStep) return;
    setActiveStepId(previousStep.id);
    setErrors({});
  }

  async function changeStudentImportFile(file: File | undefined) {
    setStudentImportFileBase64("");
    setSaveError("");
    if (!file) {
      setStudentImportUploadStatus(createIdleUploadStatus());
      updateDraft("people", { studentImportFileName: "" });
      return;
    }

    const validation = validateSetupImportFile(file);
    setStudentImportUploadStatus(validation.status);
    updateDraft("people", { studentImportFileName: validation.accepted ? validation.notice : "" });
    if (!validation.accepted) return;

    try {
      setStudentImportFileBase64(await readFileAsBase64(file));
    } catch {
      setStudentImportUploadStatus(createErrorUploadStatus(file, "Dosya okunamadı. Lütfen dosyayı yeniden seçin."));
      updateDraft("people", { studentImportFileName: "" });
      setSaveError("Öğrenci aktarım dosyası okunamadı.");
    }
  }

  async function changeTeacherImportFile(file: File | undefined) {
    setTeacherImportFileBase64("");
    setSaveError("");
    if (!file) {
      setTeacherImportUploadStatus(createIdleUploadStatus());
      updateDraft("people", { teacherImportFileName: "" });
      return;
    }
    const validation = validateSetupImportFile(file);
    setTeacherImportUploadStatus(validation.status);
    updateDraft("people", { teacherImportFileName: validation.accepted ? validation.notice : "" });
    if (!validation.accepted) return;

    try {
      setTeacherImportFileBase64(await readFileAsBase64(file));
    } catch {
      setTeacherImportUploadStatus(createErrorUploadStatus(file, "Dosya okunamadı. Lütfen dosyayı yeniden seçin."));
      updateDraft("people", { teacherImportFileName: "" });
      setSaveError("Öğretmen aktarım dosyası okunamadı.");
    }
  }

  function changeStudentModel(model: OnboardingDraft["people"]["studentModel"]) {
    setStudentImportFileBase64("");
    setStudentImportUploadStatus(createIdleUploadStatus());
    updateDraft("people", { studentImportFileName: "", studentModel: model });
  }

  function changeTeacherModel(model: OnboardingDraft["people"]["teacherModel"]) {
    setTeacherImportFileBase64("");
    setTeacherImportUploadStatus(createIdleUploadStatus());
    updateDraft("people", { teacherImportFileName: "", teacherModel: model });
  }

  async function finishSetup() {
    const allErrors = Object.fromEntries(
      steps.flatMap((step) =>
        Object.entries(validateStep(step.id, draft)).map(([field, message]) => [`${step.id}.${field}`, message]),
      ),
    );
    if (Object.keys(allErrors).length > 0) {
      const firstInvalidStep = steps.find((step) => Object.keys(validateStep(step.id, draft)).length > 0);
      if (firstInvalidStep) setActiveStepId(firstInvalidStep.id);
      setErrors(allErrors);
      return;
    }
    if (studentImportUploadStatus.state === "error") {
      setActiveStepId("people");
      setSaveError("Öğrenci aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (teacherImportUploadStatus.state === "error") {
      setActiveStepId("people");
      setSaveError("Öğretmen aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (draft.people.teacherModel === "excel" && !teacherImportFileBase64) {
      setActiveStepId("people");
      setSaveError("Öğretmen aktarım dosyası seçilmelidir.");
      return;
    }
    if (draft.people.studentModel === "excel" && !studentImportFileBase64) {
      setActiveStepId("people");
      setSaveError("Öğrenci aktarım dosyası seçilmelidir.");
      return;
    }
    if (!auth?.accessToken) {
      setSaveError("Oturum bulunamadı. Yeniden giriş yapıp tekrar deneyin.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    setSavedSummary("");
    try {
      const result = await saveSetup(auth.accessToken, draft, teacherImportFileBase64, studentImportFileBase64);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["next-academic-years", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-academic-terms", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-courses", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-classes", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-teachers", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-teacher-assignment-refs", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-students", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-student-refs", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-current-tenant", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-user-subject-refs", tenantId] }),
      ]);
      setSavedSummary(
        `${result.createdClasses} sınıf, ${result.createdCourses} ders, ${result.createdTeachers} öğretmen, ${result.createdTeacherAssignments} öğretmen ataması, ${result.createdAcademicYears} akademik yıl, ${result.createdAcademicTerms} dönem, ${result.importedStudents} öğrenci eklendi. Mevcut kayıtlar tekrar eklenmedi.`,
      );
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Kurulum kayıtları sisteme eklenemedi. Lütfen tekrar deneyin.",
      );
      return;
    } finally {
      setIsSaving(false);
    }
    writeCookie(completedCookieName, "true");
    window.sessionStorage.removeItem(draftStorageKey);
    setStudentImportFileBase64("");
    setTeacherImportFileBase64("");
    setStudentImportUploadStatus(createIdleUploadStatus());
    setTeacherImportUploadStatus(createIdleUploadStatus());
    setIsFinished(true);
  }

  return (
    <PageFrame title="Kurulum Sihirbazı" subtitle="Yeni kurumun ilk çalışma düzenini beş adımda hazırla.">
      <section className="next-onboarding-hero" aria-label="Kurulum karşılama">
        <div>
          <span>{isFinished ? "Kurulum taslağı hazır" : "İlk giriş akışı"}</span>
          <h2>{draft.general.institutionName || "Kurumunu birlikte hazırlayalım"}</h2>
          <p>Genel bilgilerden kişi yönetimine kadar temel kararları tek akışta toparla.</p>
        </div>
        <MetricGrid className="next-onboarding-metrics" aria-label="Kurulum operasyon metrikleri" role="region">
          <MetricCard label="İlerleme" value={`${progressPercent}%`} description={`${completedStepCount} / ${steps.length} adım doğrulandı`} tone={progressPercent === 100 ? "success" : "info"} />
          <MetricCard label="Ders" value={courseCount} description="Seçili ders" />
          <MetricCard label="Sınıf" value={classCount} description="Oluşturulacak şube" />
        </MetricGrid>
      </section>

      <section className="next-onboarding-progress">
        <div className="next-onboarding-progress__bar">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <Tabs label="Adım ilerlemesi" className="next-onboarding-tabs">
          {steps.map((step, index) => {
            const stepErrors = stepValidation.get(step.id) ?? {};
            const isComplete = Object.keys(stepErrors).length === 0;
            return (
              <TabButton key={step.id} selected={step.id === activeStepId} onClick={() => goToStep(step.id)}>
                <span className="next-onboarding-step-index">{index + 1}</span>
                <strong>{step.title}</strong>
                <small>{isComplete ? "Hazır" : "Eksik"}</small>
              </TabButton>
            );
          })}
        </Tabs>
      </section>

      <section className="next-onboarding-layout" aria-label="Kurulum formu">
        <Panel className="next-onboarding-panel" key={activeStep.id}>
          <header>
            <span>{activeStep.kicker}</span>
            <h2>{activeStep.title}</h2>
            <p>{activeStep.description}</p>
          </header>
          {activeStep.id === "general" ? (
            <GeneralStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          {activeStep.id === "term" ? (
            <TermStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          {activeStep.id === "classes" ? (
            <ClassesStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          {activeStep.id === "courses" ? (
            <CoursesStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          {activeStep.id === "people" ? (
            <PeopleStep
              draft={draft}
              errors={errors}
              onStudentModelChange={changeStudentModel}
              onTeacherImportFileChange={(file) => void changeTeacherImportFile(file)}
              onTeacherModelChange={changeTeacherModel}
              onStudentImportFileChange={(file) => void changeStudentImportFile(file)}
              studentImportUploadStatus={studentImportUploadStatus}
              teacherImportUploadStatus={teacherImportUploadStatus}
              updateDraft={updateDraft}
            />
          ) : null}
          <footer className="next-onboarding-actions">
            <Button variant="secondary" type="button" onClick={goBack} disabled={activeStepIndex === 0}>
              Geri
            </Button>
            {activeStepIndex < steps.length - 1 ? (
              <Button type="button" onClick={goNext}>
                İleri
              </Button>
            ) : (
              <Button type="button" onClick={() => void finishSetup()} disabled={isSaving}>
                {isSaving ? "Kaydediliyor" : "Kaydet ve bitir"}
              </Button>
            )}
          </footer>
          {saveError ? <p className="next-form-error">{saveError}</p> : null}
          {savedSummary ? <p className="next-onboarding-success">{savedSummary}</p> : null}
        </Panel>

        <Panel as="aside" className="next-onboarding-aside" aria-label="Kurulum özeti">
          <h2>Akış Özeti</h2>
          <dl>
            <div>
              <dt>Kurum</dt>
              <dd>{draft.general.institutionName || "Bekliyor"}</dd>
            </div>
            <div>
              <dt>Dönem</dt>
              <dd>{draft.term.academicYearName || "Bekliyor"}</dd>
            </div>
            <div>
              <dt>Ders</dt>
              <dd>{courseCount} seçili</dd>
            </div>
            <div>
              <dt>Sınıf</dt>
              <dd>{classCount} şube</dd>
            </div>
            <div>
              <dt>Veri modeli</dt>
              <dd>{dataModelLabel(draft.people.studentModel)}</dd>
            </div>
          </dl>
          {isFinished ? (
            <div className="next-onboarding-done">
              <strong>Kurulum taslağı tamamlandı.</strong>
              <Link className="uh-button uh-button--secondary uh-button--md" href="/kurum">
                Kurum paneline dön
              </Link>
            </div>
          ) : null}
        </Panel>
      </section>
    </PageFrame>
  );
}

function GeneralStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "general", nextValue: Partial<OnboardingDraft["general"]>) => void;
}) {
  return (
    <div className="next-onboarding-fields">
      <Field label="Kurum adı" error={errors.institutionName ?? errors["general.institutionName"]}>
        <Input
          invalid={Boolean(errors.institutionName ?? errors["general.institutionName"])}
          value={draft.general.institutionName}
          onChange={(event) => updateDraft("general", { institutionName: event.target.value })}
          placeholder="o-okul Eğitim Kurumu"
        />
      </Field>
      <Field label="Kurum türü">
        <Select
          value={draft.general.institutionType}
          onChange={(event) => updateDraft("general", { institutionType: event.target.value as OnboardingDraft["general"]["institutionType"] })}
        >
          <option value="course-center">Kurs merkezi</option>
          <option value="school">Okul</option>
          <option value="study-center">Etüt merkezi</option>
        </Select>
      </Field>
      <Field label="Logo adresi" error={errors.logoUrl ?? errors["general.logoUrl"]}>
        <Input
          invalid={Boolean(errors.logoUrl ?? errors["general.logoUrl"])}
          value={draft.general.logoUrl}
          onChange={(event) => updateDraft("general", { logoUrl: event.target.value })}
          placeholder="https://..."
        />
      </Field>
      <Field label="İletişim e-postası" error={errors.contactEmail ?? errors["general.contactEmail"]}>
        <Input
          invalid={Boolean(errors.contactEmail ?? errors["general.contactEmail"])}
          value={draft.general.contactEmail}
          onChange={(event) => updateDraft("general", { contactEmail: event.target.value })}
          placeholder="info@kurum.test"
        />
      </Field>
    </div>
  );
}

function TermStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "term", nextValue: Partial<OnboardingDraft["term"]>) => void;
}) {
  return (
    <div className="next-onboarding-fields next-onboarding-fields--two">
      <Field label="Akademik yıl adı" error={errors.academicYearName ?? errors["term.academicYearName"]}>
        <Input
          invalid={Boolean(errors.academicYearName ?? errors["term.academicYearName"])}
          value={draft.term.academicYearName}
          onChange={(event) => updateDraft("term", { academicYearName: event.target.value })}
          placeholder="2026-2027"
        />
      </Field>
      <Field label="Aktif dönem" error={errors.termName ?? errors["term.termName"]}>
        <Input
          invalid={Boolean(errors.termName ?? errors["term.termName"])}
          value={draft.term.termName}
          onChange={(event) => updateDraft("term", { termName: event.target.value })}
          placeholder="1. Dönem"
        />
      </Field>
      <Field label="Yıl başlangıcı" error={errors.startsAt ?? errors["term.startsAt"]}>
        <Input
          invalid={Boolean(errors.startsAt ?? errors["term.startsAt"])}
          type="date"
          value={draft.term.startsAt}
          onChange={(event) => updateDraft("term", { startsAt: event.target.value })}
        />
      </Field>
      <Field label="Yıl bitişi" error={errors.endsAt ?? errors["term.endsAt"]}>
        <Input
          invalid={Boolean(errors.endsAt ?? errors["term.endsAt"])}
          type="date"
          value={draft.term.endsAt}
          onChange={(event) => updateDraft("term", { endsAt: event.target.value })}
        />
      </Field>
      <Field label="Dönem başlangıcı" error={errors.termStartsAt ?? errors["term.termStartsAt"]}>
        <Input
          invalid={Boolean(errors.termStartsAt ?? errors["term.termStartsAt"])}
          type="date"
          value={draft.term.termStartsAt}
          onChange={(event) => updateDraft("term", { termStartsAt: event.target.value })}
        />
      </Field>
      <Field label="Dönem bitişi" error={errors.termEndsAt ?? errors["term.termEndsAt"]}>
        <Input
          invalid={Boolean(errors.termEndsAt ?? errors["term.termEndsAt"])}
          type="date"
          value={draft.term.termEndsAt}
          onChange={(event) => updateDraft("term", { termEndsAt: event.target.value })}
        />
      </Field>
    </div>
  );
}

function CoursesStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "courses", nextValue: Partial<OnboardingDraft["courses"]>) => void;
}) {
  const allCoursesSelected = draft.courses.selectedCourseIds.length === allCourseOptions.length;

  function selectAllCourses() {
    updateDraft("courses", { selectedCourseIds: allCourseOptions.map((course) => course.id) });
  }

  function toggleCourse(courseId: string) {
    const selected = new Set(draft.courses.selectedCourseIds);
    if (selected.has(courseId)) {
      selected.delete(courseId);
    } else {
      selected.add(courseId);
    }
    updateDraft("courses", { selectedCourseIds: [...selected] });
  }

  return (
    <div className="next-onboarding-fields">
      <div className="next-onboarding-course-actions">
        <Button variant="secondary" type="button" onClick={selectAllCourses} disabled={allCoursesSelected}>
          Hepsini Seç
        </Button>
      </div>
      {courseGroups.map((group) => (
        <section className="next-onboarding-course-group" key={group.title}>
          <header>
            <h3>{group.title}</h3>
            <span>{group.source}</span>
          </header>
          <div className="next-onboarding-course-grid">
            {group.courses.map((course) => (
              <button
                key={course.id}
                type="button"
                aria-pressed={draft.courses.selectedCourseIds.includes(course.id)}
                onClick={() => toggleCourse(course.id)}
              >
                <strong>{course.name}</strong>
                <small>{course.code}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
      <FieldError message={errors.selectedCourseIds ?? errors["courses.selectedCourseIds"]} />
    </div>
  );
}

function ClassesStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "classes", nextValue: Partial<OnboardingDraft["classes"]>) => void;
}) {
  const generatedClasses = generateClasses(draft.classes.classCounts);

  return (
    <div className="next-onboarding-fields">
      <fieldset className="next-onboarding-class-counts">
        <legend>Kademeye göre sınıf sayısı</legend>
        {stageOptions.map((stage) => {
          const fieldError = errors[`classCounts.${stage.id}`] ?? errors[`classes.classCounts.${stage.id}`];
          return (
            <Field key={stage.id} label={stage.label} error={fieldError}>
              <Input
                invalid={Boolean(fieldError)}
                inputMode="numeric"
                value={draft.classes.classCounts[stage.id]}
                onChange={(event) =>
                  updateDraft("classes", {
                    classCounts: {
                      ...draft.classes.classCounts,
                      [stage.id]: event.target.value,
                    },
                  })
                }
                placeholder="0"
              />
            </Field>
          );
        })}
      </fieldset>
      <FieldError message={errors.classCounts ?? errors["classes.classCounts"]} />
      <section className="next-onboarding-auto-classes" aria-label="Otomatik atanacak sınıflar">
        <h3>Otomatik atanacak şubeler</h3>
        <div>
          {generatedClasses.map((classRecord) => (
            <span key={`${classRecord.level}-${classRecord.section}`}>{classRecord.name}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function PeopleStep({
  draft,
  errors,
  onStudentModelChange,
  onTeacherImportFileChange,
  onTeacherModelChange,
  onStudentImportFileChange,
  studentImportUploadStatus,
  teacherImportUploadStatus,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  onStudentModelChange(model: OnboardingDraft["people"]["studentModel"]): void;
  onTeacherImportFileChange(file: File | undefined): void;
  onTeacherModelChange(model: OnboardingDraft["people"]["teacherModel"]): void;
  onStudentImportFileChange(file: File | undefined): void;
  studentImportUploadStatus: SetupUploadStatus;
  teacherImportUploadStatus: SetupUploadStatus;
  updateDraft: (section: "people", nextValue: Partial<OnboardingDraft["people"]>) => void;
}) {
  function downloadTeacherTemplate() {
    const sampleClassName = sampleClassNameFromDraft(draft);
    downloadCsvFile(
      "ogretmen-aktarim-sablonu.csv",
      [
        ["ad", "soyad", "brans", "atanacak_sinif", "ders"],
        ["Ayse", "Yilmaz", "Matematik", sampleClassName, "Matematik"],
      ],
    );
  }

  function downloadStudentTemplate() {
    const sampleClassName = sampleClassNameFromDraft(draft);
    downloadCsvFile(
      "ogrenci-aktarim-sablonu.csv",
      [
        [
          "okul_no",
          "ad",
          "soyad",
          "email",
          "telefon",
          "dogum_tarihi",
          "tc_kimlik_no",
          "sinif",
          "veli_ad",
          "veli_soyad",
          "veli_telefon",
          "veli_email",
          "veli_iliski",
          "veli_birincil",
          "veli_finans",
          "veli_sms",
          "veli_duyuru",
          "veli_destek",
        ],
        [
          "100",
          "Ogrenci",
          "Deneme",
          "ogrenci@example.com",
          "5550000000",
          "2012-09-01",
          "",
          sampleClassName,
          "Veli",
          "Deneme",
          "5550000001",
          "veli@example.com",
          "anne",
          "evet",
          "hayir",
          "evet",
          "evet",
          "hayir",
        ],
      ],
    );
  }

  function downloadCsvFile(fileName: string, rows: string[][]) {
    const content = rows
      .map((row) => row.map(escapeCsvCell).join(";"))
      .join("\n");
    const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="next-onboarding-fields">
      <section className="next-onboarding-choice" aria-labelledby="teacher-model-label">
        <span className="next-onboarding-choice__label" id="teacher-model-label">Öğretmen veri girişi</span>
        <SegmentedControl label="Öğretmen veri girişi">
          <button type="button" aria-pressed={draft.people.teacherModel === "manual"} onClick={() => onTeacherModelChange("manual")}>
            Tek tek giriş
          </button>
          <button type="button" aria-pressed={draft.people.teacherModel === "excel"} onClick={() => onTeacherModelChange("excel")}>
            Excel aktarımı
          </button>
        </SegmentedControl>
      </section>
      <section className="next-onboarding-choice" aria-labelledby="student-model-label">
        <span className="next-onboarding-choice__label" id="student-model-label">Öğrenci veri girişi</span>
        <SegmentedControl label="Öğrenci veri girişi">
          <button type="button" aria-pressed={draft.people.studentModel === "manual"} onClick={() => onStudentModelChange("manual")}>
            Tek tek giriş
          </button>
          <button type="button" aria-pressed={draft.people.studentModel === "excel"} onClick={() => onStudentModelChange("excel")}>
            Excel aktarımı
          </button>
        </SegmentedControl>
      </section>
      <section className="next-onboarding-template-panel">
        <div>
          <h3>Aktarım şablonları</h3>
          <p>Öğretmen ve öğrenci aktarımı için ayrı, sade ve uygulama alanlarına uyumlu dosyalar.</p>
        </div>
        <div className="next-onboarding-template-actions">
          <Button variant="secondary" type="button" onClick={downloadTeacherTemplate}>
            Öğretmen CSV şablonu
          </Button>
          <Button variant="secondary" type="button" onClick={downloadStudentTemplate}>
            Öğrenci CSV şablonu
          </Button>
        </div>
      </section>
      <Field
        label="Öğretmen aktarım dosyası"
        description={describeSelectedUploadFileNotice(
          draft.people.teacherImportFileName,
          "Öğretmen XLSX veya CSV dosyası seçilebilir.",
        )}
        error={errors.teacherImportFileName ?? errors["people.teacherImportFileName"]}
      >
        <Input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            onTeacherImportFileChange(file);
            event.currentTarget.value = "";
          }}
        />
      </Field>
      <ImportUploadStatus label="Öğretmen aktarım güven durumu" status={teacherImportUploadStatus} />
      <Field
        label="Öğrenci aktarım dosyası"
        description={describeSelectedUploadFileNotice(
          draft.people.studentImportFileName,
          "Öğrenci XLSX veya CSV dosyası seçilebilir.",
        )}
        error={errors.studentImportFileName ?? errors["people.studentImportFileName"]}
      >
        <Input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            onStudentImportFileChange(file);
            event.currentTarget.value = "";
          }}
        />
      </Field>
      <ImportUploadStatus label="Öğrenci aktarım güven durumu" status={studentImportUploadStatus} />
      <Field label="Veri sorumlusu" error={errors.importOwner ?? errors["people.importOwner"]}>
        <Input
          invalid={Boolean(errors.importOwner ?? errors["people.importOwner"])}
          value={draft.people.importOwner}
          onChange={(event) => updateDraft("people", { importOwner: event.target.value })}
          placeholder="Operasyon sorumlusu"
        />
      </Field>
      <Checkbox
        className="next-onboarding-check"
        checked={draft.people.inviteTeachers}
        label="Öğretmen portal davetleri hazırlansın"
        onChange={(event) => updateDraft("people", { inviteTeachers: event.target.checked })}
      />
      <Checkbox
        className="next-onboarding-check"
        checked={draft.people.inviteGuardians}
        label="Veli portal davetleri öğrenci kayıtlarından sonra hazırlansın"
        onChange={(event) => updateDraft("people", { inviteGuardians: event.target.checked })}
      />
    </div>
  );
}

function ImportUploadStatus({ label, status }: { label: string; status: SetupUploadStatus }) {
  return (
    <div
      className="next-onboarding-upload-status"
      data-state={status.state}
      aria-label={label}
      role={status.state === "error" ? "alert" : "status"}
    >
      <StatusBadge tone={status.tone}>{status.badge}</StatusBadge>
      <div>
        <strong>{status.title}</strong>
        <span>{status.meta}</span>
      </div>
      <p>{status.detail}</p>
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="next-form-error">{message}</span> : null;
}

function validateStep(stepId: StepId, draft: OnboardingDraft): StepErrors {
  if (stepId === "general") return validateGeneral(draft.general);
  if (stepId === "term") return validateTerm(draft.term);
  if (stepId === "courses") return validateCourses(draft.courses);
  if (stepId === "classes") return validateClasses(draft.classes);
  return validatePeople(draft.people);
}

function validateGeneral(general: OnboardingDraft["general"]): StepErrors {
  const errors: StepErrors = {};
  if (general.institutionName.trim().length < 2) {
    errors.institutionName = "Kurum adı en az 2 karakter olmalıdır.";
  }
  if (general.logoUrl.trim() && !isUrl(general.logoUrl)) {
    errors.logoUrl = "Logo adresi geçerli bir URL olmalıdır.";
  }
  if (general.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(general.contactEmail.trim())) {
    errors.contactEmail = "E-posta geçerli olmalıdır.";
  }
  return errors;
}

function validateTerm(term: OnboardingDraft["term"]): StepErrors {
  const errors: StepErrors = {};
  if (!term.academicYearName.trim()) errors.academicYearName = "Akademik yıl adı zorunludur.";
  if (!term.termName.trim()) errors.termName = "Aktif dönem adı zorunludur.";
  validateDateRange(term.startsAt, term.endsAt, "startsAt", "endsAt", errors);
  validateDateRange(term.termStartsAt, term.termEndsAt, "termStartsAt", "termEndsAt", errors);
  return errors;
}

function validateCourses(courses: OnboardingDraft["courses"]): StepErrors {
  return selectedCourseOptions(courses.selectedCourseIds).length > 0 ? {} : { selectedCourseIds: "En az bir ders seçilmelidir." };
}

function validateClasses(classes: OnboardingDraft["classes"]): StepErrors {
  const errors: StepErrors = {};
  let totalClassCount = 0;
  for (const stage of stageOptions) {
    const classCount = Number(classes.classCounts[stage.id]);
    if (!Number.isInteger(classCount) || classCount < 0) {
      errors[`classCounts.${stage.id}`] = "Sınıf sayısı 0 veya pozitif tam sayı olmalıdır.";
      continue;
    }
    if (classCount > 26) {
      errors[`classCounts.${stage.id}`] = "Bir kademe için en fazla 26 şube oluşturulabilir.";
    }
    totalClassCount += classCount;
  }
  if (totalClassCount <= 0) {
    errors.classCounts = "En az bir kademe için sınıf sayısı girilmelidir.";
  }
  return errors;
}

function validatePeople(people: OnboardingDraft["people"]): StepErrors {
  const errors: StepErrors = {};
  if (people.importOwner.trim().length <= 1) {
    errors.importOwner = "Veri sorumlusu zorunludur.";
  }
  if (people.teacherModel === "excel" && !people.teacherImportFileName) {
    errors.teacherImportFileName = "Öğretmen aktarım dosyası zorunludur.";
  }
  if (people.studentModel === "excel" && !people.studentImportFileName) {
    errors.studentImportFileName = "Öğrenci aktarım dosyası zorunludur.";
  }
  return errors;
}

function validateDateRange(startsAt: string, endsAt: string, startField: string, endField: string, errors: StepErrors) {
  if (!isDate(startsAt)) errors[startField] = "Başlangıç tarihi zorunludur.";
  if (!isDate(endsAt)) errors[endField] = "Bitiş tarihi zorunludur.";
  if (isDate(startsAt) && isDate(endsAt) && Date.parse(startsAt) >= Date.parse(endsAt)) {
    errors[endField] = "Bitiş başlangıçtan sonra olmalıdır.";
  }
}

function dataModelLabel(model: OnboardingDraft["people"]["studentModel"]) {
  if (model === "manual") return "Tek tek giriş";
  return "Excel aktarımı";
}

function formatSelectedUploadFileNotice(fileName: string) {
  const extension = fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  return extension ? `${extension} dosyası seçildi` : "Dosya seçildi";
}

function validateSetupImportFile(
  file: File,
  options: { detail?: string; suffix?: string } = {},
): { accepted: boolean; notice: string; status: SetupUploadStatus } {
  const extension = inferSetupImportExtension(file);
  if (!extension || !setupImportAllowedExtensions.has(extension)) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, "CSV veya XLSX dosyası seçin."),
    };
  }
  if (file.size <= 0) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, "Dosya boş görünüyor. Dolu bir aktarım dosyası seçin."),
    };
  }
  if (file.size > setupImportMaxBytes) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, `Dosya en fazla ${formatUploadByteSize(setupImportMaxBytes)} olabilir.`),
    };
  }

  return {
    accepted: true,
    notice: formatSelectedUploadFileNotice(`upload.${extension.toLocaleLowerCase("tr-TR")}`),
    status: {
      badge: "Yerel kontrol",
      detail: options.detail ?? "Ham dosya adı ve kişi bilgisi ekranda veya saklı taslakta gösterilmez.",
      meta: `${extension} • ${formatUploadByteSize(file.size)} • ${options.suffix ?? "Sunucu dry-run bekliyor"}`,
      state: "ready",
      title: "Yerel kontrol tamam",
      tone: "success",
    },
  };
}

function inferSetupImportExtension(file: File): SetupImportFileExtension | undefined {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  if (extension === "CSV" || extension === "XLSX") return extension;
  if (file.type === "text/csv" || file.type === "text/plain") return "CSV";
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "XLSX";
  return undefined;
}

function createIdleUploadStatus(): SetupUploadStatus {
  return {
    badge: "Bekliyor",
    detail: "Dosya adı saklanmaz; yalnız tür, boyut ve yerel kontrol sonucu gösterilir.",
    meta: `CSV/XLSX • en fazla ${formatUploadByteSize(setupImportMaxBytes)}`,
    state: "idle",
    title: "Dosya bekleniyor",
    tone: "info",
  };
}

function createErrorUploadStatus(file: File, detail: string): SetupUploadStatus {
  const extension = inferSetupImportExtension(file) ?? "DESTEKLENMEYEN";
  return {
    badge: "Kontrol hatası",
    detail,
    meta: `${extension} • ${formatUploadByteSize(file.size)}`,
    state: "error",
    title: "Dosya kabul edilmedi",
    tone: "danger",
  };
}

function formatUploadByteSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${(byteSize / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

function describeSelectedUploadFileNotice(value: string, fallback: string) {
  if (value === "Dosya seçildi" || /^[A-Z0-9]+ dosyası seçildi$/.test(value)) return value;
  return fallback;
}

function selectedCourseOptions(selectedCourseIds: string[]) {
  const selected = new Set(selectedCourseIds);
  const uniqueByName = new Map<string, { id: string; name: string; code: string }>();
  for (const course of allCourseOptions) {
    if (selected.has(course.id) && !uniqueByName.has(course.name)) {
      uniqueByName.set(course.name, course);
    }
  }
  return [...uniqueByName.values()];
}

function generateClasses(classCounts: Record<StageId, string>) {
  return stageOptions.flatMap((stage) => {
    const classCount = Number(classCounts[stage.id]);
    if (!Number.isInteger(classCount) || classCount <= 0) return [];
    return Array.from({ length: Math.min(classCount, 26) }, (_item, index) => {
      const section = String.fromCharCode(65 + index);
      return {
        level: stage.id,
        name: `${stageClassPrefix(stage.id)} ${section}`,
        section,
      };
    });
  });
}

function stageClassPrefix(stage: StageId) {
  if (stage === "8-LGS") return "8 LGS";
  return stage;
}

function sampleClassNameFromDraft(draft: OnboardingDraft) {
  return generateClasses(draft.classes.classCounts)[0]?.name ?? `${stageClassPrefix("8-LGS")} A`;
}

async function saveSetup(
  accessToken: string,
  draft: OnboardingDraft,
  teacherImportFileBase64: string,
  studentImportFileBase64: string,
) {
  await apiRequest<TenantProfileRecord>(accessToken, `${apiBaseUrl}/me/tenant`, {
    body: JSON.stringify({
      name: draft.general.institutionName,
      institutionType: draft.general.institutionType,
      contactEmail: draft.general.contactEmail || undefined,
      logoUrl: draft.general.logoUrl || undefined,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });

  const [existingCourses, existingClasses, existingYears, existingTerms] = await Promise.all([
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses?limit=200`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes?limit=200`),
    apiListRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years?limit=200`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms?limit=200`),
  ]);
  const existingCourseNames = new Set(existingCourses.data.map((course) => normalizeValue(course.name)));
  const existingClassNames = new Set(existingClasses.data.map((classRecord) => normalizeValue(classRecord.name)));
  const existingYear = existingYears.data.find((year) => normalizeValue(year.name) === normalizeValue(draft.term.academicYearName));
  let createdCourses = 0;
  let createdClasses = 0;
  let createdAcademicYears = 0;
  let createdAcademicTerms = 0;
  let createdTeachers = 0;
  let createdTeacherAssignments = 0;
  let importedStudents = 0;

  const academicYear = existingYear ?? await apiRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years`, {
    body: JSON.stringify({
      endsAt: draft.term.endsAt,
      isActive: true,
      name: draft.term.academicYearName,
      startsAt: draft.term.startsAt,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!existingYear) createdAcademicYears += 1;

  const existingTerm = existingTerms.data.find(
    (term) => term.academicYearId === academicYear.id && normalizeValue(term.name) === normalizeValue(draft.term.termName),
  );
  if (!existingTerm) {
    await apiRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`, {
      body: JSON.stringify({
        academicYearId: academicYear.id,
        endsAt: draft.term.termEndsAt,
        isActive: true,
        name: draft.term.termName,
        startsAt: draft.term.termStartsAt,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdAcademicTerms += 1;
  }

  for (const course of selectedCourseOptions(draft.courses.selectedCourseIds)) {
    if (existingCourseNames.has(normalizeValue(course.name))) continue;
    await apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, {
      body: JSON.stringify({ code: course.code, name: course.name }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdCourses += 1;
  }

  for (const classRecord of generateClasses(draft.classes.classCounts)) {
    if (existingClassNames.has(normalizeValue(classRecord.name))) continue;
    await apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`, {
      body: JSON.stringify(classRecord),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdClasses += 1;
  }

  if (draft.people.teacherModel === "excel" && teacherImportFileBase64) {
    const dryRun = await apiRequest<TeacherImportDryRunResult>(accessToken, `${apiBaseUrl}/teachers/imports/dry-run`, {
      body: JSON.stringify({ fileBase64: teacherImportFileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!dryRun.wouldImport) {
      throw new Error(teacherImportErrorMessage(dryRun));
    }
    const imported = await apiRequest<TeacherImportResult>(accessToken, `${apiBaseUrl}/teachers/imports`, {
      body: JSON.stringify({ fileBase64: teacherImportFileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdTeachers = imported.createdTeachers;
    createdTeacherAssignments = imported.createdAssignments;
  }

  if (draft.people.studentModel === "excel" && studentImportFileBase64) {
    const dryRun = await apiRequest<StudentImportDryRunResult>(accessToken, `${apiBaseUrl}/students/imports/dry-run`, {
      body: JSON.stringify({ fileBase64: studentImportFileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!dryRun.wouldImport) {
      throw new Error(studentImportErrorMessage(dryRun));
    }
    const imported = await apiRequest<StudentImportResult>(accessToken, `${apiBaseUrl}/students/imports`, {
      body: JSON.stringify({ fileBase64: studentImportFileBase64 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    importedStudents = imported.importedRows;
  }

  return {
    createdAcademicTerms,
    createdAcademicYears,
    createdClasses,
    createdCourses,
    createdTeacherAssignments,
    createdTeachers,
    importedStudents,
  };
}

function teacherImportErrorMessage(dryRun: TeacherImportDryRunResult) {
  const classError = dryRun.errors.find((error) => error.code === "CLASS_NOT_FOUND");
  if (classError) {
    return `Öğretmen dosyasında sistemde olmayan sınıf var. Satır: ${classError.row}.`;
  }

  const courseError = dryRun.errors.find((error) => error.code === "COURSE_NOT_FOUND");
  if (courseError) {
    return `Öğretmen dosyasında sistemde olmayan ders var. Satır: ${courseError.row}.`;
  }

  const requiredError = dryRun.errors.find((error) => error.code === "REQUIRED");
  if (requiredError) {
    if (requiredError.field === "className") {
      return `Öğretmen dosyasında ders ataması için sınıf alanı eksik. Satır: ${requiredError.row}.`;
    }
    const fieldName = requiredError.field === "firstName" ? "ad" : "soyad";
    return `Öğretmen dosyasında zorunlu ${fieldName} alanı eksik. Satır: ${requiredError.row}.`;
  }

  return "Öğretmen aktarım dosyası içe aktarılamadı. Dosyayı kontrol edip tekrar deneyin.";
}

function studentImportErrorMessage(dryRun: StudentImportDryRunResult) {
  const quotaError = dryRun.errors.find((error) => error.code === "STUDENT_QUOTA_EXCEEDED");
  if (quotaError && dryRun.quota) {
    return `Öğrenci dosyası kota sınırını aşıyor. Sınır: ${dryRun.quota.limit}, mevcut: ${dryRun.quota.current}, dosyada: ${dryRun.quota.incoming}.`;
  }

  const classError = dryRun.errors.find((error) => error.code === "CLASS_NOT_FOUND");
  if (classError) {
    return `Öğrenci dosyasında sistemde olmayan sınıf var. Satır: ${classError.row}.`;
  }

  const requiredError = dryRun.errors.find((error) => error.code === "REQUIRED");
  if (requiredError) {
    const fieldName = requiredError.field === "firstName" ? "ad" : "soyad";
    return `Öğrenci dosyasında zorunlu ${fieldName} alanı eksik. Satır: ${requiredError.row}.`;
  }

  const duplicateStudentNo = dryRun.errors.find((error) => error.code === "STUDENT_NO_DUPLICATE");
  if (duplicateStudentNo) {
    return `Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı okul no var. Satır: ${duplicateStudentNo.row}.`;
  }

  const duplicateNationalId = dryRun.errors.find((error) => error.code === "STUDENT_NATIONAL_ID_DUPLICATE");
  if (duplicateNationalId) {
    return `Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı TC kimlik no var. Satır: ${duplicateNationalId.row}.`;
  }

  const invalidEmail = dryRun.errors.find((error) => error.code === "INVALID_EMAIL");
  if (invalidEmail) {
    return `Öğrenci dosyasında geçersiz e-posta var. Satır: ${invalidEmail.row}.`;
  }

  const invalidDate = dryRun.errors.find((error) => error.code === "INVALID_DATE");
  if (invalidDate) {
    return `Öğrenci dosyasında tarih YYYY-AA-GG formatında olmalı. Satır: ${invalidDate.row}.`;
  }

  const invalidNationalId = dryRun.errors.find((error) => error.code === "INVALID_NATIONAL_ID");
  if (invalidNationalId) {
    return `Öğrenci dosyasında geçersiz TC kimlik no var. Satır: ${invalidNationalId.row}.`;
  }

  return "Öğrenci aktarım dosyası içe aktarılamadı. Dosyayı kontrol edip tekrar deneyin.";
}

function escapeCsvCell(value: string): string {
  if (!/[;"\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function normalizeValue(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function loadCurrentTenant(accessToken: string) {
  return apiRequest<TenantProfileRecord>(accessToken, `${apiBaseUrl}/me/tenant`);
}

function mergeTenantProfileDraft(draft: OnboardingDraft, tenant: TenantProfileRecord): OnboardingDraft {
  if (draft.general.institutionName.trim()) return draft;
  return {
    ...draft,
    general: {
      ...draft.general,
      contactEmail: tenant.contactEmail ?? "",
      institutionName: tenant.name,
      institutionType: normalizeInstitutionType(tenant.institutionType),
      logoUrl: tenant.logoUrl ?? "",
    },
  };
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isDate(value: string) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function isUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function mergeDraft(rawDraft: string): OnboardingDraft {
  try {
    const parsed = JSON.parse(rawDraft) as Partial<OnboardingDraft>;
    const parsedPeople: Partial<OnboardingDraft["people"]> = parsed.people ?? {};
    const parsedClasses = parsed.classes as (Partial<OnboardingDraft["classes"]> & {
      classCount?: unknown;
      stage?: unknown;
    }) | undefined;
    const parsedCourses: Partial<OnboardingDraft["courses"]> = parsed.courses ?? {};
    return {
      classes: {
        ...initialDraft.classes,
        classCounts: normalizeClassCounts(parsedClasses),
      },
      courses: {
        ...initialDraft.courses,
        ...parsedCourses,
        selectedCourseIds: Array.isArray(parsedCourses.selectedCourseIds)
          ? normalizeCourseIds(parsedCourses.selectedCourseIds)
          : initialDraft.courses.selectedCourseIds,
      },
      general: {
        ...initialDraft.general,
        ...parsed.general,
        institutionType: normalizeInstitutionType(parsed.general?.institutionType),
      },
      people: {
        ...initialDraft.people,
        ...parsedPeople,
        studentModel: isPeopleModel(parsedPeople.studentModel) ? parsedPeople.studentModel : initialDraft.people.studentModel,
        teacherModel: isPeopleModel(parsedPeople.teacherModel) ? parsedPeople.teacherModel : initialDraft.people.teacherModel,
      },
      term: { ...initialDraft.term, ...parsed.term },
    };
  } catch {
    return initialDraft;
  }
}

function sanitizeDraftForStorage(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    general: {
      ...draft.general,
      contactEmail: "",
    },
    people: {
      ...draft.people,
      importOwner: "",
      studentImportFileName: "",
      teacherImportFileName: "",
    },
  };
}

function normalizeInstitutionType(value: unknown): OnboardingDraft["general"]["institutionType"] {
  if (value === "school" || value === "study-center" || value === "course-center") return value;
  return initialDraft.general.institutionType;
}

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && stageOptions.some((stage) => stage.id === value);
}

function normalizeStageId(value: unknown): StageId {
  if (value === "LGS") return "8-LGS";
  return isStageId(value) ? value : "8-LGS";
}

function normalizeClassCounts(
  value: (Partial<OnboardingDraft["classes"]> & { classCount?: unknown; stage?: unknown }) | undefined,
) {
  const classCounts = { ...initialDraft.classes.classCounts };
  if (value?.classCounts && typeof value.classCounts === "object") {
    for (const stage of stageOptions) {
      const count = value.classCounts[stage.id];
      if (typeof count === "string") classCounts[stage.id] = count;
    }
  }
  if (value?.classCount !== undefined) {
    const legacyStage = normalizeStageId(value.stage);
    classCounts[legacyStage] = String(value.classCount);
  }
  return classCounts;
}

function normalizeCourseIds(values: unknown[]) {
  const legacyCourseIdById: Record<string, string> = {
    "lgs-turkce": "8-lgs-turkce",
    "lgs-matematik": "8-lgs-matematik",
    "lgs-fen": "8-lgs-fen",
    "lgs-inkilap": "8-lgs-inkilap",
    "lgs-din": "8-lgs-din",
    "lgs-ingilizce": "8-lgs-ingilizce",
  };
  const validIds = new Set(allCourseOptions.map((course) => course.id));
  const normalized = values
    .filter((id): id is string => typeof id === "string")
    .map((id) => legacyCourseIdById[id] ?? id)
    .filter((id) => validIds.has(id));
  return normalized.length > 0 ? normalized : initialDraft.courses.selectedCourseIds;
}

function isPeopleModel(value: unknown): value is OnboardingDraft["people"]["studentModel"] {
  return value === "manual" || value === "excel";
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function readDraftFromSession(key: string) {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraftToSession(key: string, draft: OnboardingDraft) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Draft persistence is a convenience; setup can continue without it.
  }
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
