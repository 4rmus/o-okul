export interface SetupReadinessCheck {
  description: string;
  href: string;
  id:
    | "campuses"
    | "grade-levels"
    | "classes"
    | "courses"
    | "teachers"
    | "students"
    | "learning-outcomes";
  optional?: boolean;
  title: string;
}

export interface SetupFlowStep {
  description: string;
  id: "general" | "term" | "classes" | "courses" | "people" | "readiness";
  kicker: string;
  path: string;
  readinessChecks: readonly SetupReadinessCheck[];
  title: string;
}

export type SetupWizardStep = SetupReadinessCheck;

export const setupFlowSteps: readonly SetupFlowStep[] = [
  {
    id: "general",
    path: "/kurum/kurulum/genel",
    kicker: "1. Adım",
    title: "Kurum Genel Bilgileri",
    description: "Kurum adı, türü ve marka bilgisi.",
    readinessChecks: [
      { id: "campuses", title: "Kampüs", description: "Sınıf ve öğrenci yapısını bağlayacağın kampüsü ekle.", href: "/kurum/kampusler?new=1", optional: true },
    ],
  },
  {
    id: "term",
    path: "/kurum/kurulum/donem",
    kicker: "2. Adım",
    title: "Akademik Dönem Ayarları",
    description: "Yıl ve aktif dönem tarihleri.",
    readinessChecks: [],
  },
  {
    id: "classes",
    path: "/kurum/kurulum/siniflar",
    kicker: "3. Adım",
    title: "Sınıf ve Şubeler",
    description: "Kademe ve sınıf sayısına göre şubeleri otomatik oluştur.",
    readinessChecks: [
      { id: "grade-levels", title: "Seviye", description: "8. sınıf gibi seviyeleri tanımla.", href: "/kurum/seviyeler?new=1", optional: true },
      { id: "classes", title: "Sınıf", description: "Öğrencileri yerleştireceğin ilk sınıfı oluştur.", href: "/kurum/siniflar?new=1" },
    ],
  },
  {
    id: "courses",
    path: "/kurum/kurulum/dersler",
    kicker: "4. Adım",
    title: "Derslerin Oluşturulması",
    description: "LGS ve TYT/AYT derslerini tıklayarak seç.",
    readinessChecks: [
      { id: "courses", title: "Ders", description: "Program, sınav ve öğretmen akışları için dersleri hazırla.", href: "/kurum/dersler?new=1", optional: true },
      { id: "learning-outcomes", title: "Kazanım", description: "Sınav ve optik analizlerinde kullanılacak ilk kazanımı ekle.", href: "/kurum/kazanimlar?new=1", optional: true },
    ],
  },
  {
    id: "people",
    path: "/kurum/kurulum/kisiler",
    kicker: "5. Adım",
    title: "Kişi Yönetim Altyapısı",
    description: "Öğretmen ve öğrenci veri giriş modeli.",
    readinessChecks: [
      { id: "teachers", title: "Öğretmen", description: "İlk öğretmen kaydını aç.", href: "/kurum/ogretmenler?new=1" },
      { id: "students", title: "Öğrenci", description: "İlk öğrenciyi ekleyerek çekirdek kurulumu tamamla.", href: "/kurum/ogrenciler?new=1" },
    ],
  },
  {
    id: "readiness",
    path: "/kurum/kurulum/hazirlik",
    kicker: "6. Adım",
    title: "Hazırlık Kontrolü",
    description: "Sunucudaki gerçek kurum kayıtlarını doğrula ve eksik adımları gör.",
    readinessChecks: [],
  },
] as const;

export const setupWizardSteps: readonly SetupWizardStep[] = setupFlowSteps.flatMap((step) => step.readinessChecks);
