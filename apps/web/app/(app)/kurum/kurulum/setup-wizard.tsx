"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ClassRecord, CourseRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, queryClient } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";

type StepId = "general" | "term" | "courses" | "classes" | "people";
type StageId = "7" | "8-LGS" | "10" | "11" | "12" | "TYT/AYT";

interface OnboardingDraft {
  classes: {
    stage: StageId;
    classCount: string;
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
    stage: "8-LGS",
    classCount: "2",
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
  const activeStepIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepId));
  const activeStep = steps[activeStepIndex]!;
  const stepValidation = useMemo(
    () => new Map(steps.map((step) => [step.id, validateStep(step.id, draft)])),
    [draft],
  );
  const completedStepCount = steps.filter((step) => Object.keys(stepValidation.get(step.id) ?? {}).length === 0).length;
  const progressPercent = Math.round((completedStepCount / steps.length) * 100);
  const selectedCourses = selectedCourseOptions(draft.courses.selectedCourseIds);
  const generatedClasses = generateClasses(draft.classes.stage, draft.classes.classCount);
  const courseCount = selectedCourses.length;
  const classCount = generatedClasses.length;

  useEffect(() => {
    if (!auth || typeof window === "undefined") return;
    const storedDraft = window.localStorage.getItem(draftStorageKey);
    if (storedDraft) {
      setDraft(mergeDraft(storedDraft));
    }
    setIsFinished(readCookie(completedCookieName) === "true");
  }, [auth, completedCookieName, draftStorageKey]);

  useEffect(() => {
    if (!auth || typeof window === "undefined") return;
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [auth, draft, draftStorageKey]);

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
    if (!auth?.accessToken) {
      setSaveError("Oturum bulunamadı. Yeniden giriş yapıp tekrar deneyin.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    setSavedSummary("");
    try {
      const result = await saveSetup(auth.accessToken, draft);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["next-courses", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-classes", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] }),
      ]);
      setSavedSummary(`${result.createdClasses} sınıf, ${result.createdCourses} ders eklendi. Mevcut kayıtlar tekrar eklenmedi.`);
    } catch {
      setSaveError("Kurulum kayıtları sisteme eklenemedi. Lütfen tekrar deneyin.");
      return;
    } finally {
      setIsSaving(false);
    }
    writeCookie(completedCookieName, "true");
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
        <div className="next-onboarding-score" aria-label="Kurulum ilerleme durumu">
          <strong>{progressPercent}%</strong>
          <span>{completedStepCount} / {steps.length} adım doğrulandı</span>
        </div>
      </section>

      <section className="next-onboarding-progress" aria-label="Adım ilerlemesi">
        <div className="next-onboarding-progress__bar">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <ol>
          {steps.map((step, index) => {
            const stepErrors = stepValidation.get(step.id) ?? {};
            const isComplete = Object.keys(stepErrors).length === 0;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className="next-onboarding-step-tab"
                  aria-current={step.id === activeStepId ? "step" : undefined}
                  onClick={() => goToStep(step.id)}
                >
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                  <small>{isComplete ? "Hazır" : "Eksik"}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="next-onboarding-layout" aria-label="Kurulum formu">
        <div className="next-onboarding-panel" key={activeStep.id}>
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
            <PeopleStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          <footer className="next-onboarding-actions">
            <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={goBack} disabled={activeStepIndex === 0}>
              Geri
            </button>
            {activeStepIndex < steps.length - 1 ? (
              <button className="uh-button uh-button--primary uh-button--md" type="button" onClick={goNext}>
                İleri
              </button>
            ) : (
              <button className="uh-button uh-button--primary uh-button--md" type="button" onClick={() => void finishSetup()} disabled={isSaving}>
                {isSaving ? "Kaydediliyor" : "Kaydet ve bitir"}
              </button>
            )}
          </footer>
          {saveError ? <p className="next-form-error">{saveError}</p> : null}
          {savedSummary ? <p className="next-onboarding-success">{savedSummary}</p> : null}
        </div>

        <aside className="next-onboarding-aside" aria-label="Kurulum özeti">
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
              <dd>{draft.classes.stage} için {classCount} şube</dd>
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
        </aside>
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
      <label>
        Kurum adı
        <input
          value={draft.general.institutionName}
          onChange={(event) => updateDraft("general", { institutionName: event.target.value })}
          placeholder="Uzman Hocam Eğitim Kurumu"
        />
        <FieldError message={errors.institutionName ?? errors["general.institutionName"]} />
      </label>
      <label>
        Kurum türü
        <select
          value={draft.general.institutionType}
          onChange={(event) => updateDraft("general", { institutionType: event.target.value as OnboardingDraft["general"]["institutionType"] })}
        >
          <option value="course-center">Kurs merkezi</option>
          <option value="school">Okul</option>
          <option value="study-center">Etüt merkezi</option>
        </select>
      </label>
      <label>
        Logo adresi
        <input
          value={draft.general.logoUrl}
          onChange={(event) => updateDraft("general", { logoUrl: event.target.value })}
          placeholder="https://..."
        />
        <FieldError message={errors.logoUrl ?? errors["general.logoUrl"]} />
      </label>
      <label>
        İletişim e-postası
        <input
          value={draft.general.contactEmail}
          onChange={(event) => updateDraft("general", { contactEmail: event.target.value })}
          placeholder="info@kurum.test"
        />
        <FieldError message={errors.contactEmail ?? errors["general.contactEmail"]} />
      </label>
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
      <label>
        Akademik yıl adı
        <input
          value={draft.term.academicYearName}
          onChange={(event) => updateDraft("term", { academicYearName: event.target.value })}
          placeholder="2026-2027"
        />
        <FieldError message={errors.academicYearName ?? errors["term.academicYearName"]} />
      </label>
      <label>
        Aktif dönem
        <input
          value={draft.term.termName}
          onChange={(event) => updateDraft("term", { termName: event.target.value })}
          placeholder="1. Dönem"
        />
        <FieldError message={errors.termName ?? errors["term.termName"]} />
      </label>
      <label>
        Yıl başlangıcı
        <input
          type="date"
          value={draft.term.startsAt}
          onChange={(event) => updateDraft("term", { startsAt: event.target.value })}
        />
        <FieldError message={errors.startsAt ?? errors["term.startsAt"]} />
      </label>
      <label>
        Yıl bitişi
        <input
          type="date"
          value={draft.term.endsAt}
          onChange={(event) => updateDraft("term", { endsAt: event.target.value })}
        />
        <FieldError message={errors.endsAt ?? errors["term.endsAt"]} />
      </label>
      <label>
        Dönem başlangıcı
        <input
          type="date"
          value={draft.term.termStartsAt}
          onChange={(event) => updateDraft("term", { termStartsAt: event.target.value })}
        />
        <FieldError message={errors.termStartsAt ?? errors["term.termStartsAt"]} />
      </label>
      <label>
        Dönem bitişi
        <input
          type="date"
          value={draft.term.termEndsAt}
          onChange={(event) => updateDraft("term", { termEndsAt: event.target.value })}
        />
        <FieldError message={errors.termEndsAt ?? errors["term.termEndsAt"]} />
      </label>
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
        <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={selectAllCourses} disabled={allCoursesSelected}>
          Hepsini Seç
        </button>
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
  const generatedClasses = generateClasses(draft.classes.stage, draft.classes.classCount);

  return (
    <div className="next-onboarding-fields">
      <fieldset className="next-onboarding-choice">
        <legend>Kademe</legend>
        {stageOptions.map((stage) => (
          <ChoiceButton
            key={stage.id}
            active={draft.classes.stage === stage.id}
            label={stage.label}
            onClick={() => updateDraft("classes", { stage: stage.id })}
          />
        ))}
      </fieldset>
      <label>
        Bu kademedeki sınıf sayısı
        <input
          inputMode="numeric"
          value={draft.classes.classCount}
          onChange={(event) => updateDraft("classes", { classCount: event.target.value })}
          placeholder="2"
        />
        <FieldError message={errors.classCount ?? errors["classes.classCount"]} />
      </label>
      <section className="next-onboarding-auto-classes" aria-label="Otomatik atanacak sınıflar">
        <h3>Otomatik atanacak şubeler</h3>
        <div>
          {generatedClasses.map((classRecord) => (
            <span key={classRecord.section}>{classRecord.name}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function PeopleStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "people", nextValue: Partial<OnboardingDraft["people"]>) => void;
}) {
  function downloadTeacherTemplate() {
    const sampleClassName = `${stageClassPrefix(draft.classes.stage)} A`;
    downloadExcelLikeFile(
      "ogretmen-aktarim-sablonu.xls",
      [
        ["ad", "soyad", "email", "telefon", "brans", "atanacak_sinif", "not"],
        ["Ayse", "Yilmaz", "ayse@example.test", "5551112233", "Matematik", sampleClassName, "Branş öğretmeni"],
      ],
    );
  }

  function downloadStudentTemplate() {
    const sampleClassName = `${stageClassPrefix(draft.classes.stage)} A`;
    downloadExcelLikeFile(
      "ogrenci-aktarim-sablonu.xls",
      [
        ["ad", "soyad", "email", "telefon", "sinif", "veli_ad", "veli_soyad", "veli_telefon"],
        ["Mehmet", "Demir", "mehmet@example.test", "5552223344", sampleClassName, "Fatma", "Demir", "5553334455"],
      ],
    );
  }

  function downloadExcelLikeFile(fileName: string, rows: string[][]) {
    const content = rows
      .map((row) => row.join(";"))
      .join("\n");
    const blob = new Blob([`\uFEFF${content}`], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="next-onboarding-fields">
      <fieldset className="next-onboarding-choice">
        <legend>Öğretmen veri girişi</legend>
        <ChoiceButton
          active={draft.people.teacherModel === "manual"}
          label="Tek tek giriş"
          onClick={() => updateDraft("people", { teacherModel: "manual" })}
        />
        <ChoiceButton
          active={draft.people.teacherModel === "excel"}
          label="Excel aktarımı"
          onClick={() => updateDraft("people", { teacherModel: "excel" })}
        />
      </fieldset>
      <fieldset className="next-onboarding-choice">
        <legend>Öğrenci veri girişi</legend>
        <ChoiceButton
          active={draft.people.studentModel === "manual"}
          label="Tek tek giriş"
          onClick={() => updateDraft("people", { studentModel: "manual" })}
        />
        <ChoiceButton
          active={draft.people.studentModel === "excel"}
          label="Excel aktarımı"
          onClick={() => updateDraft("people", { studentModel: "excel" })}
        />
      </fieldset>
      <section className="next-onboarding-template-panel">
        <div>
          <h3>Excel şablonları</h3>
          <p>Öğretmen ve öğrenci aktarımı için ayrı, sade ve uygulama alanlarına uyumlu dosyalar.</p>
        </div>
        <div className="next-onboarding-template-actions">
          <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={downloadTeacherTemplate}>
            Öğretmen şablonu
          </button>
          <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={downloadStudentTemplate}>
            Öğrenci şablonu
          </button>
        </div>
      </section>
      <label>
        Öğretmen aktarım dosyası
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          onChange={(event) => updateDraft("people", { teacherImportFileName: event.target.files?.[0]?.name ?? "" })}
        />
        <span className="next-field-help">{draft.people.teacherImportFileName || "Öğretmen Excel veya CSV dosyası seçilebilir."}</span>
      </label>
      <label>
        Öğrenci aktarım dosyası
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          onChange={(event) => updateDraft("people", { studentImportFileName: event.target.files?.[0]?.name ?? "" })}
        />
        <span className="next-field-help">{draft.people.studentImportFileName || "Öğrenci Excel veya CSV dosyası seçilebilir."}</span>
      </label>
      <label>
        Veri sorumlusu
        <input
          value={draft.people.importOwner}
          onChange={(event) => updateDraft("people", { importOwner: event.target.value })}
          placeholder="Operasyon sorumlusu"
        />
        <FieldError message={errors.importOwner ?? errors["people.importOwner"]} />
      </label>
      <label className="next-onboarding-check">
        <input
          type="checkbox"
          checked={draft.people.inviteTeachers}
          onChange={(event) => updateDraft("people", { inviteTeachers: event.target.checked })}
        />
        Öğretmen portal davetleri hazırlansın
      </label>
      <label className="next-onboarding-check">
        <input
          type="checkbox"
          checked={draft.people.inviteGuardians}
          onChange={(event) => updateDraft("people", { inviteGuardians: event.target.checked })}
        />
        Veli portal davetleri öğrenci kayıtlarından sonra hazırlansın
      </label>
    </div>
  );
}

function ChoiceButton({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}>
      {label}
    </button>
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
  const classCount = Number(classes.classCount);
  if (!Number.isInteger(classCount) || classCount <= 0) {
    errors.classCount = "Sınıf sayısı pozitif tam sayı olmalıdır.";
  }
  if (classCount > 26) {
    errors.classCount = "Tek seferde en fazla 26 şube oluşturulabilir.";
  }
  return errors;
}

function validatePeople(people: OnboardingDraft["people"]): StepErrors {
  return people.importOwner.trim().length > 1 ? {} : { importOwner: "Veri sorumlusu zorunludur." };
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

function generateClasses(stage: StageId, classCountValue: string) {
  const classCount = Number(classCountValue);
  if (!Number.isInteger(classCount) || classCount <= 0) return [];
  return Array.from({ length: Math.min(classCount, 26) }, (_item, index) => {
    const section = String.fromCharCode(65 + index);
    return {
      level: stage,
      name: `${stageClassPrefix(stage)} ${section}`,
      section,
    };
  });
}

function stageClassPrefix(stage: StageId) {
  if (stage === "8-LGS") return "8 LGS";
  return stage;
}

async function saveSetup(accessToken: string, draft: OnboardingDraft) {
  const [existingCourses, existingClasses] = await Promise.all([
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses?limit=200`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes?limit=200`),
  ]);
  const existingCourseNames = new Set(existingCourses.data.map((course) => normalizeValue(course.name)));
  const existingClassNames = new Set(existingClasses.data.map((classRecord) => normalizeValue(classRecord.name)));
  let createdCourses = 0;
  let createdClasses = 0;

  for (const course of selectedCourseOptions(draft.courses.selectedCourseIds)) {
    if (existingCourseNames.has(normalizeValue(course.name))) continue;
    await apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, {
      body: JSON.stringify({ code: course.code, name: course.name }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdCourses += 1;
  }

  for (const classRecord of generateClasses(draft.classes.stage, draft.classes.classCount)) {
    if (existingClassNames.has(normalizeValue(classRecord.name))) continue;
    await apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`, {
      body: JSON.stringify(classRecord),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdClasses += 1;
  }

  return { createdClasses, createdCourses };
}

function normalizeValue(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
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
    const parsedClasses: Partial<OnboardingDraft["classes"]> = parsed.classes ?? {};
    const parsedCourses: Partial<OnboardingDraft["courses"]> = parsed.courses ?? {};
    return {
      classes: {
        ...initialDraft.classes,
        ...parsedClasses,
        stage: normalizeStageId(parsedClasses.stage),
      },
      courses: {
        ...initialDraft.courses,
        ...parsedCourses,
        selectedCourseIds: Array.isArray(parsedCourses.selectedCourseIds)
          ? normalizeCourseIds(parsedCourses.selectedCourseIds)
          : initialDraft.courses.selectedCourseIds,
      },
      general: { ...initialDraft.general, ...parsed.general },
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

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && stageOptions.some((stage) => stage.id === value);
}

function normalizeStageId(value: unknown): StageId {
  if (value === "LGS") return "8-LGS";
  return isStageId(value) ? value : initialDraft.classes.stage;
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

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
