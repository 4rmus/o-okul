import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  LifeBuoy,
  Megaphone,
  MessageSquareText,
  NotebookTabs,
  ScanLine,
  School,
  Settings,
  ShieldCheck,
  UserRoundCog,
  Users,
} from "lucide-react";

type InstitutionNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  requiredCapability?: string;
};

type InstitutionNavGroup = {
  label: string;
  items: InstitutionNavigationItem[];
};

type SystemNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

type SystemNavGroup = {
  label: string;
  items: SystemNavigationItem[];
};

type RolePortalItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectType: "TEACHER" | "STUDENT" | "GUARDIAN";
};

export const institutionNavGroups: readonly InstitutionNavGroup[] = [
  {
    label: "Başlangıç",
    items: [
      { href: "/kurum", icon: LayoutDashboard, label: "Özet" },
      { href: "/kurum/kurulum", icon: Settings, label: "Kurulum" },
    ],
  },
  {
    label: "Kişiler",
    items: [
      { href: "/kurum/ogrenciler", icon: GraduationCap, label: "Öğrenciler", requiredCapability: "student:manage" },
      { href: "/kurum/veliler", icon: Users, label: "Veliler", requiredCapability: "student:manage" },
      { href: "/kurum/ogretmenler", icon: UserRoundCog, label: "Öğretmenler", requiredCapability: "staff:manage" },
    ],
  },
  {
    label: "Eğitim",
    items: [
      { href: "/kurum/siniflar", icon: School, label: "Sınıflar", requiredCapability: "class:manage" },
      { href: "/kurum/seviyeler", icon: ClipboardList, label: "Seviyeler", requiredCapability: "class:manage" },
      { href: "/kurum/kampusler", icon: Building2, label: "Kampüsler", requiredCapability: "class:manage" },
      { href: "/kurum/dersler", icon: BookOpen, label: "Dersler", requiredCapability: "academic:manage" },
      { href: "/kurum/program", icon: CalendarDays, label: "Program", requiredCapability: "academic:manage" },
      { href: "/kurum/etutler", icon: NotebookTabs, label: "Etütler", requiredCapability: "academic:manage" },
      { href: "/kurum/devamsizlik", icon: ClipboardCheck, label: "Devamsızlık", requiredCapability: "attendance:manage" },
      { href: "/kurum/akademik-takvim", icon: CalendarDays, label: "Takvim", requiredCapability: "academic:manage" },
    ],
  },
  {
    label: "Sınav ve Analiz",
    items: [
      { href: "/kurum/sinavlar", icon: FileText, label: "Sınavlar", requiredCapability: "academic:manage" },
      { href: "/kurum/kazanimlar", icon: ClipboardList, label: "Kazanımlar", requiredCapability: "academic:manage" },
      { href: "/kurum/optik", icon: ScanLine, label: "Optik Okuma", requiredCapability: "academic:manage" },
      { href: "/kurum/raporlar", icon: BarChart3, label: "Raporlar", requiredCapability: "academic:manage" },
    ],
  },
  {
    label: "İçerik",
    items: [
      { href: "/kurum/materyaller", icon: Library, label: "Materyaller", requiredCapability: "academic:manage" },
      { href: "/kurum/notlar", icon: NotebookTabs, label: "Notlar", requiredCapability: "note:manage" },
      { href: "/kurum/duyurular", icon: Megaphone, label: "Duyurular", requiredCapability: "announcement:manage" },
      { href: "/kurum/sablonlar", icon: MessageSquareText, label: "Mesaj Şablonları", requiredCapability: "announcement:manage" },
    ],
  },
  {
    label: "Finans ve Destek",
    items: [
      { href: "/kurum/finans", icon: CreditCard, label: "Ödemeler", requiredCapability: "finance:manage" },
      { href: "/kurum/destek", icon: LifeBuoy, label: "Destek", requiredCapability: "support:manage" },
    ],
  },
  {
    label: "Yönetim",
    items: [
      { href: "/kurum/kullanicilar", icon: Users, label: "Kullanıcılar", requiredCapability: "user:manage" },
      { href: "/kurum/rol-onizleme", icon: ShieldCheck, label: "Rol Önizleme", requiredCapability: "role-preview:manage" },
      { href: "/kurum/yedek-restore", icon: Activity, label: "Yedekleme", requiredCapability: "operation:manage" },
    ],
  },
];

export const systemNavGroups: readonly SystemNavGroup[] = [
  {
    label: "Başlangıç",
    items: [
      { href: "/sistem", icon: LayoutDashboard, label: "Özet" },
      { href: "/sistem/kurumlar", icon: Building2, label: "Kurumlar" },
    ],
  },
  {
    label: "İzleme",
    items: [
      { href: "/sistem/sistem-sagligi", icon: Activity, label: "Sağlık" },
      { href: "/sistem/gozlemlenebilirlik", icon: BarChart3, label: "Gözlem" },
      { href: "/sistem/denetim", icon: ClipboardList, label: "Denetim" },
    ],
  },
];

export const rolePortalItems: readonly RolePortalItem[] = [
  { href: "/ogretmen", icon: UserRoundCog, label: "Öğretmen Portalı", role: "TEACHER", subjectType: "TEACHER" },
  { href: "/ogrenci", icon: GraduationCap, label: "Öğrenci Portalı", role: "STUDENT", subjectType: "STUDENT" },
  { href: "/veli", icon: Users, label: "Veli Portalı", role: "GUARDIAN", subjectType: "GUARDIAN" },
];

export const staticBreadcrumbLabels: Record<string, string> = {
  "/": "Ana Sayfa",
  "/sistem": "Sistem Özeti",
  "/sistem/kurumlar": "Kurumlar",
  "/sistem/sistem-sagligi": "Sağlık",
  "/sistem/gozlemlenebilirlik": "Gözlem",
  "/sistem/denetim": "Denetim",
  "/kurum": "Kurum Özeti",
  "/kurum/kurulum": "Kurulum",
  "/ogretmen": "Öğretmen Portalı",
  "/ogrenci": "Öğrenci Portalı",
  "/veli": "Veli Portalı",
  "/kurum/akademik-takvim": "Takvim",
  "/kurum/canli-yayin": "Canlı Yayın",
  "/kurum/denetim": "Denetim",
  "/kurum/dersler": "Dersler",
  "/kurum/destek": "Destek",
  "/kurum/devamsizlik": "Devamsızlık",
  "/kurum/duyurular": "Duyurular",
  "/kurum/etutler": "Etütler",
  "/kurum/finans": "Finans",
  "/kurum/gozlemlenebilirlik": "Gözlem",
  "/kurum/guvenlik-denetimi": "Güvenlik Denetimi",
  "/kurum/kampusler": "Kampüsler",
  "/kurum/kazanimlar": "Kazanımlar",
  "/kurum/kullanicilar": "Kullanıcılar",
  "/kurum/kvkk": "KVKK",
  "/kurum/materyaller": "Materyaller",
  "/kurum/notlar": "Notlar",
  "/kurum/ogrenciler": "Öğrenciler",
  "/kurum/ogretmenler": "Öğretmenler",
  "/kurum/optik": "Optik Okuma",
  "/kurum/program": "Program",
  "/kurum/raporlar": "Raporlar",
  "/kurum/rol-onizleme": "Rol Önizleme",
  "/kurum/seviyeler": "Seviyeler",
  "/kurum/sinavlar": "Sınavlar",
  "/kurum/siniflar": "Sınıflar",
  "/kurum/sistem-sagligi": "Sağlık",
  "/kurum/sablonlar": "Mesaj Şablonları",
  "/kurum/uat-rollback": "UAT / Rollback",
  "/kurum/veliler": "Veliler",
  "/kurum/yedek-restore": "Yedekleme",
};

export const dynamicDetailParents: string[] = ["ogrenciler", "ogretmenler", "veliler", "siniflar", "duyurular"];
