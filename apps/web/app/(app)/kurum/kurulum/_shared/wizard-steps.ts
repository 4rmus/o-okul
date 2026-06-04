export interface SetupWizardStep {
  description: string;
  href: string;
  id:
    | "campuses"
    | "grade-levels"
    | "classes"
    | "courses"
    | "teachers"
    | "students"
    | "guardians"
    | "guardian-links"
    | "learning-outcomes";
  optional?: boolean;
  title: string;
}

export const setupWizardSteps: readonly SetupWizardStep[] = [
  {
    id: "campuses",
    title: "Kampüs",
    description: "Sınıf ve öğrenci yapısını bağlayacağın kampüsü ekle.",
    href: "/kurum/kampusler?new=1",
    optional: true,
  },
  {
    id: "grade-levels",
    title: "Seviye",
    description: "8. sınıf gibi seviyeleri tanımla.",
    href: "/kurum/seviyeler?new=1",
    optional: true,
  },
  {
    id: "classes",
    title: "Sınıf",
    description: "Öğrencileri yerleştireceğin ilk sınıfı oluştur.",
    href: "/kurum/siniflar?new=1",
  },
  {
    id: "courses",
    title: "Ders",
    description: "Program, sınav ve öğretmen akışları için dersleri hazırla.",
    href: "/kurum/dersler?new=1",
    optional: true,
  },
  {
    id: "teachers",
    title: "Öğretmen",
    description: "İlk öğretmen kaydını aç.",
    href: "/kurum/ogretmenler?new=1",
  },
  {
    id: "students",
    title: "Öğrenci",
    description: "İlk öğrenciyi ekleyerek çekirdek kurulumu tamamla.",
    href: "/kurum/ogrenciler?new=1",
  },
  {
    id: "guardians",
    title: "Veli",
    description: "Öğrenci iletişimi ve portal davetleri için ilk veli kaydını oluştur.",
    href: "/kurum/veliler?new=1",
    optional: true,
  },
  {
    id: "guardian-links",
    title: "Veli-öğrenci bağı",
    description: "Veli kaydını öğrenciyle bağla ve portal daveti adımına hazırlan.",
    href: "/kurum/veliler",
    optional: true,
  },
  {
    id: "learning-outcomes",
    title: "Kazanım",
    description: "Sınav ve optik analizlerinde kullanılacak ilk kazanımı ekle.",
    href: "/kurum/kazanimlar?new=1",
    optional: true,
  },
] as const;
