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

export type InstitutionNavigationItem = {
  href: string;
  hiddenFromRail?: boolean;
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

export const institutionOperationEvidenceItems: readonly InstitutionNavigationItem[] = [
  { href: "/kurum/yedek-restore", hiddenFromRail: true, icon: Activity, label: "Yedekleme", requiredCapability: "operation:manage" },
  { href: "/kurum/kvkk", hiddenFromRail: true, icon: ShieldCheck, label: "KVKK", requiredCapability: "privacy:manage" },
  { href: "/kurum/denetim", hiddenFromRail: true, icon: ClipboardList, label: "Denetim", requiredCapability: "audit:read" },
  { href: "/kurum/sistem-sagligi", hiddenFromRail: true, icon: Activity, label: "Sistem Sağlığı", requiredCapability: institutionOperationEvidenceCapability },
  { href: "/kurum/gozlemlenebilirlik", hiddenFromRail: true, icon: BarChart3, label: "Sistem İzleme", requiredCapability: institutionOperationEvidenceCapability },
  { href: "/kurum/uat-rollback", hiddenFromRail: true, icon: ClipboardCheck, label: "Kabul ve Geri Dönüş", requiredCapability: institutionOperationEvidenceCapability },
  { href: "/kurum/guvenlik-denetimi", hiddenFromRail: true, icon: ShieldCheck, label: "Güvenlik Denetimi", requiredCapability: institutionOperationEvidenceCapability },
  { href: "/kurum/canli-yayin", hiddenFromRail: true, icon: Activity, label: "Yayın Hazırlığı", requiredCapability: institutionOperationEvidenceCapability },
];

export const institutionNavGroups: readonly InstitutionNavGroup[] = [
  {
    label: "Bugün",
    items: [
      { href: "/kurum", icon: LayoutDashboard, label: "Özet" },
      { href: "/kurum/kurulum", icon: Settings, label: "Kurulum", requiredCapability: "setup:manage" },
    ],
  },
  {
    label: "Öğrenci ve eğitim",
    items: [
      { href: "/kurum/ogrenciler", icon: GraduationCap, label: "Öğrenciler", requiredCapability: "student:manage" },
      { href: "/kurum/veliler", icon: Users, label: "Veli kayıtları", requiredCapability: "student:manage" },
      { href: "/kurum/ogretmenler", icon: UserRoundCog, label: "Öğretmenler", requiredCapability: "staff:manage" },
      { href: "/kurum/siniflar", icon: School, label: "Sınıflar", requiredCapability: "class:manage" },
      { href: "/kurum/seviyeler", icon: ClipboardList, label: "Seviyeler", requiredCapability: "class:manage" },
      { href: "/kurum/kampusler", icon: Building2, label: "Kampüsler", requiredCapability: "class:manage" },
      { href: "/kurum/dersler", icon: BookOpen, label: "Dersler", requiredCapability: "academic:manage" },
      { href: "/kurum/program", icon: CalendarDays, label: "Program", requiredCapability: "academic:manage" },
      { href: "/kurum/etutler", icon: NotebookTabs, label: "Etütler", requiredCapability: "academic:manage" },
      { href: "/kurum/devamsizlik", icon: ClipboardCheck, label: "Devamsızlık", requiredCapability: "attendance:manage" },
      { href: "/kurum/akademik-takvim", icon: CalendarDays, label: "Takvim", requiredCapability: "academic:manage" },
      { href: "/kurum/materyaller", icon: Library, label: "Materyaller", requiredCapability: "academic:manage" },
      { href: "/kurum/notlar", icon: NotebookTabs, label: "Notlar", requiredCapability: "note:manage" },
    ],
  },
  {
    label: "Sınav ve rapor",
    items: [
      { href: "/kurum/sinavlar", icon: FileText, label: "Sınavlar", requiredCapability: "academic:manage" },
      { href: "/kurum/kazanimlar", icon: ClipboardList, label: "Kazanımlar", requiredCapability: "academic:manage" },
      { href: "/kurum/optik", icon: ScanLine, label: "Optik Okuma", requiredCapability: "academic:manage" },
      { href: "/kurum/raporlar", icon: BarChart3, label: "Sınav Raporları", requiredCapability: "academic:manage" },
    ],
  },
  {
    label: "İletişim",
    items: [
      { href: "/kurum/duyurular", icon: Megaphone, label: "Duyurular", requiredCapability: "announcement:manage" },
      ...(isSmsEnabled ? [{ href: "/kurum/sablonlar", icon: MessageSquareText, label: "Mesaj Şablonları", requiredCapability: "announcement:manage" }] : []),
      { href: "/kurum/destek", icon: LifeBuoy, label: "Kurum içi destek", requiredCapability: "support:manage" },
    ],
  },
  {
    label: "Yönetim",
    items: [
      { href: "/kurum/finans", icon: CreditCard, label: "Ödeme planları", requiredCapability: "finance:manage" },
      { href: "/kurum/calisanlar", icon: UserRoundCog, label: "Çalışanlar ve Yetkiler", requiredCapability: "user:manage" },
      { href: "/kurum/ogrenci-portal-erisimi", icon: GraduationCap, label: "Öğrenci Portal Erişimi", requiredCapability: "user:manage" },
      { href: "/kurum/kullanicilar", icon: Users, label: "Kullanıcılar", requiredCapability: "user:manage" },
      { href: "/kurum/lisans-donemleri", icon: ClipboardCheck, label: "Lisans Dönemleri", requiredCapability: "setup:manage" },
      { href: "/kurum/rol-onizleme", icon: ShieldCheck, label: "Rol Önizleme", requiredCapability: "role-preview:manage" },
      { href: "/kurum/operasyon-ve-kanit", icon: ShieldCheck, label: "Operasyon ve kanıt", requiredCapability: institutionOperationEvidenceCapability },
      ...institutionOperationEvidenceItems,
    ],
  },
];

const institutionV2Areas = [
  {
    label: "Bugün",
    hrefs: ["/kurum"],
  },
  {
    label: "Kişiler",
    hrefs: [
      "/kurum/ogrenciler",
      "/kurum/veliler",
      "/kurum/ogretmenler",
      "/kurum/calisanlar",
      "/kurum/ogrenci-portal-erisimi",
      "/kurum/kullanicilar",
    ],
  },
  {
    label: "Akademik",
    hrefs: [
      "/kurum/siniflar",
      "/kurum/seviyeler",
      "/kurum/kampusler",
      "/kurum/dersler",
      "/kurum/program",
      "/kurum/etutler",
      "/kurum/devamsizlik",
      "/kurum/akademik-takvim",
      "/kurum/materyaller",
      "/kurum/notlar",
    ],
  },
  {
    label: "Sınav",
    hrefs: ["/kurum/sinavlar", "/kurum/kazanimlar", "/kurum/optik", "/kurum/raporlar"],
  },
  {
    label: "İletişim",
    hrefs: ["/kurum/duyurular", "/kurum/sablonlar", "/kurum/destek"],
  },
  {
    label: "Finans",
    hrefs: ["/kurum/finans"],
  },
  {
    label: "Ayarlar",
    hrefs: ["/kurum/kurulum", "/kurum/lisans-donemleri", "/kurum/rol-onizleme", "/kurum/operasyon-ve-kanit"],
  },
] as const;

const institutionRailItemByHref = new Map(
  institutionNavGroups.flatMap((group) => group.items)
    .filter((item) => !item.hiddenFromRail)
    .map((item) => [item.href, item]),
);

export const institutionNavGroupsV2: readonly InstitutionNavGroup[] = institutionV2Areas.map((area) => ({
  label: area.label,
  items: area.hrefs.flatMap((href) => {
    const item = institutionRailItemByHref.get(href);
    return item ? [item] : [];
  }),
}));

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
      { href: "/ogretmen/destek", icon: LifeBuoy, label: "Kurum içi destek" },
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
      { href: "/ogrenci/destek", icon: LifeBuoy, label: "Kurum içi destek" },
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
      { href: "/veli/odemeler", icon: CreditCard, label: "Ödeme planları" },
      { href: "/veli/odevler", icon: NotebookTabs, label: "Ödevler" },
      { href: "/veli/duyurular", icon: Megaphone, label: "Duyurular" },
      { href: "/veli/bildirimler", icon: MessageSquareText, label: "Bildirimler" },
      { href: "/veli/destek", icon: LifeBuoy, label: "Kurum içi destek" },
    ],
  },
];

export const staticBreadcrumbLabels: Record<string, string> = {
  "/": "Ana Sayfa",
  "/hesap": "Hesap",
  "/hesap/oturumlar": "Oturumlar",
  "/sistem": "Sistem Özeti",
  "/kurum": "Kurum Özeti",
  "/ogretmen": "Öğretmen Portalı",
  "/ogrenci": "Öğrenci Portalı",
  "/veli": "Veli Portalı",
  "/kurum/finans": "Finans",
  "/kurum/gozlemlenebilirlik": "Gözlem",
  "/kurum/sistem-sagligi": "Sağlık",
  "/kurum/sablonlar": "Mesaj Şablonları",
  "/kurum/operasyon-ve-kanit": "Operasyon ve kanıt",
};

export const dynamicDetailParents: string[] = ["ogrenciler", "ogretmenler", "veliler", "siniflar", "sinavlar", "duyurular"];
