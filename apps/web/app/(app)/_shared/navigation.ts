import type { LucideIcon } from "lucide-react";
import { isSmsEnabled } from "../../../src/sms-feature.js";
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

type RolePortalNavGroup = {
  label: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectType: "TEACHER" | "STUDENT" | "GUARDIAN";
  items: RolePortalNavigationItem[];
};

type RolePortalNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

const institutionOperationEvidenceCapability = "operation:manage";

export const institutionNavGroups: readonly InstitutionNavGroup[] = [
  {
    label: "Başlangıç",
    items: [
      { href: "/kurum", icon: LayoutDashboard, label: "Özet" },
      { href: "/kurum/kurulum", icon: Settings, label: "Kurulum", requiredCapability: "operation:manage" },
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
      ...(isSmsEnabled ? [{ href: "/kurum/sablonlar", icon: MessageSquareText, label: "Mesaj Şablonları", requiredCapability: "announcement:manage" }] : []),
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
    label: "Yönetim ve Kanıt",
    items: [
      { href: "/kurum/kullanicilar", icon: Users, label: "Kullanıcılar", requiredCapability: "user:manage" },
      { href: "/kurum/rol-onizleme", icon: ShieldCheck, label: "Rol Önizleme", requiredCapability: "role-preview:manage" },
      { href: "/kurum/yedek-restore", icon: Activity, label: "Yedekleme", requiredCapability: "operation:manage" },
      { href: "/kurum/kvkk", icon: ShieldCheck, label: "KVKK", requiredCapability: "privacy:manage" },
      { href: "/kurum/denetim", icon: ClipboardList, label: "Denetim", requiredCapability: "audit:read" },
      { href: "/kurum/sistem-sagligi", icon: Activity, label: "Sistem Sağlığı", requiredCapability: institutionOperationEvidenceCapability },
      { href: "/kurum/gozlemlenebilirlik", icon: BarChart3, label: "Gözlemlenebilirlik", requiredCapability: institutionOperationEvidenceCapability },
      { href: "/kurum/uat-rollback", icon: ClipboardCheck, label: "UAT / Rollback", requiredCapability: institutionOperationEvidenceCapability },
      { href: "/kurum/guvenlik-denetimi", icon: ShieldCheck, label: "Güvenlik Denetimi", requiredCapability: institutionOperationEvidenceCapability },
      { href: "/kurum/canli-yayin", icon: Activity, label: "Release Kanıtı", requiredCapability: institutionOperationEvidenceCapability },
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

export const rolePortalNavGroups: readonly RolePortalNavGroup[] = [
  {
    label: "Öğretmen Paneli",
    role: "TEACHER",
    subjectType: "TEACHER",
    items: [
      { href: "/ogretmen", icon: LayoutDashboard, label: "Özet" },
      { href: "/ogretmen/ders-akisi", icon: CalendarDays, label: "Ders Akışı" },
      { href: "/ogretmen/ogrenci-takibi", icon: GraduationCap, label: "Öğrenci Takibi" },
      { href: "/ogretmen/odevler", icon: NotebookTabs, label: "Ödev Kontrolü" },
      { href: "/ogretmen/raporlar", icon: BarChart3, label: "Sınav Raporu" },
      { href: "/ogretmen/duyurular", icon: Megaphone, label: "Duyurular" },
      { href: "/ogretmen/destek", icon: LifeBuoy, label: "Destek" },
    ],
  },
  {
    label: "Öğrenci Paneli",
    role: "STUDENT",
    subjectType: "STUDENT",
    items: [
      { href: "/ogrenci", icon: LayoutDashboard, label: "Özet" },
      { href: "/ogrenci/raporlar", icon: BarChart3, label: "Sınav Raporu" },
      { href: "/ogrenci/odevler", icon: NotebookTabs, label: "Ödevler" },
      { href: "/ogrenci/duyurular", icon: Megaphone, label: "Duyurular" },
      { href: "/ogrenci/devamsizlik", icon: ClipboardCheck, label: "Devamsızlık" },
      { href: "/ogrenci/profil", icon: GraduationCap, label: "Profil" },
      { href: "/ogrenci/destek", icon: LifeBuoy, label: "Destek" },
    ],
  },
  {
    label: "Veli Paneli",
    role: "GUARDIAN",
    subjectType: "GUARDIAN",
    items: [
      { href: "/veli", icon: LayoutDashboard, label: "Özet" },
      { href: "/veli/ogrenci", icon: GraduationCap, label: "Öğrenci" },
      { href: "/veli/raporlar", icon: BarChart3, label: "Sınav Raporu" },
      { href: "/veli/odemeler", icon: CreditCard, label: "Ödemeler" },
      { href: "/veli/odevler", icon: NotebookTabs, label: "Ödevler" },
      { href: "/veli/duyurular", icon: Megaphone, label: "Duyurular" },
      { href: "/veli/bildirimler", icon: MessageSquareText, label: "Bildirimler" },
      { href: "/veli/destek", icon: LifeBuoy, label: "Destek" },
    ],
  },
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
  "/ogretmen/ders-akisi": "Ders Akışı",
  "/ogretmen/ogrenci-takibi": "Öğrenci Takibi",
  "/ogretmen/odevler": "Ödev Kontrolü",
  "/ogretmen/raporlar": "Sınav Raporu",
  "/ogretmen/duyurular": "Duyurular",
  "/ogretmen/destek": "Destek",
  "/ogrenci": "Öğrenci Portalı",
  "/ogrenci/raporlar": "Sınav Raporu",
  "/ogrenci/odevler": "Ödevler",
  "/ogrenci/duyurular": "Duyurular",
  "/ogrenci/devamsizlik": "Devamsızlık",
  "/ogrenci/profil": "Profil",
  "/ogrenci/destek": "Destek",
  "/veli": "Veli Portalı",
  "/veli/ogrenci": "Öğrenci",
  "/veli/raporlar": "Sınav Raporu",
  "/veli/odemeler": "Ödemeler",
  "/veli/odevler": "Ödevler",
  "/veli/duyurular": "Duyurular",
  "/veli/bildirimler": "Bildirimler",
  "/veli/destek": "Destek",
  "/kurum/akademik-takvim": "Takvim",
  "/kurum/canli-yayin": "Release Kanıtı",
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
