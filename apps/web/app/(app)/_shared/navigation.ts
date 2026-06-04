type InstitutionNavigationItem = {
  href: string;
  label: string;
  requiredCapability?: string;
};

type InstitutionNavGroup = {
  label: string;
  items: InstitutionNavigationItem[];
};

type SystemNavigationItem = {
  href: string;
  label: string;
};

type SystemNavGroup = {
  label: string;
  items: SystemNavigationItem[];
};

type RolePortalItem = {
  href: string;
  label: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectType: "TEACHER" | "STUDENT" | "GUARDIAN";
};

export const institutionNavGroups: readonly InstitutionNavGroup[] = [
  {
    label: "Kurum",
    items: [
      { href: "/kurum", label: "Kurum Paneli" },
      { href: "/kurum/kurulum", label: "Kurulum" },
    ],
  },
  {
    label: "Kişiler",
    items: [
      { href: "/kurum/ogrenciler", label: "Öğrenciler", requiredCapability: "student:manage" },
      { href: "/kurum/veliler", label: "Veliler", requiredCapability: "student:manage" },
      { href: "/kurum/ogretmenler", label: "Öğretmenler", requiredCapability: "staff:manage" },
    ],
  },
  {
    label: "Akademik",
    items: [
      { href: "/kurum/kampusler", label: "Kampüsler", requiredCapability: "class:manage" },
      { href: "/kurum/akademik-takvim", label: "Akademik Takvim", requiredCapability: "academic:manage" },
      { href: "/kurum/seviyeler", label: "Seviyeler", requiredCapability: "class:manage" },
      { href: "/kurum/siniflar", label: "Sınıflar", requiredCapability: "class:manage" },
      { href: "/kurum/dersler", label: "Dersler", requiredCapability: "academic:manage" },
      { href: "/kurum/program", label: "Ders Programı", requiredCapability: "academic:manage" },
      { href: "/kurum/etutler", label: "Etütler", requiredCapability: "academic:manage" },
      { href: "/kurum/devamsizlik", label: "Devamsızlık", requiredCapability: "attendance:manage" },
      { href: "/kurum/notlar", label: "Öğretmen Notları", requiredCapability: "note:manage" },
      { href: "/kurum/materyaller", label: "Materyaller", requiredCapability: "academic:manage" },
    ],
  },
  {
    label: "Sınav ve Rapor",
    items: [
      { href: "/kurum/kazanimlar", label: "Kazanımlar", requiredCapability: "academic:manage" },
      { href: "/kurum/sinavlar", label: "Sınavlar", requiredCapability: "academic:manage" },
      { href: "/kurum/optik", label: "Optik", requiredCapability: "academic:manage" },
      { href: "/kurum/raporlar", label: "Raporlar", requiredCapability: "academic:manage" },
    ],
  },
  {
    label: "Finans",
    items: [{ href: "/kurum/finans", label: "Ödemeler", requiredCapability: "finance:manage" }],
  },
  {
    label: "İletişim",
    items: [
      { href: "/kurum/duyurular", label: "Duyurular", requiredCapability: "announcement:manage" },
      { href: "/kurum/sablonlar", label: "Şablonlar", requiredCapability: "announcement:manage" },
      { href: "/kurum/destek", label: "Destek", requiredCapability: "support:manage" },
    ],
  },
  {
    label: "Operasyon",
    items: [
      { href: "/kurum/kullanicilar", label: "Kullanıcılar", requiredCapability: "user:manage" },
      { href: "/kurum/rol-onizleme", label: "Rol Önizleme", requiredCapability: "role-preview:manage" },
      { href: "/kurum/denetim", label: "Denetim", requiredCapability: "audit:read" },
      { href: "/kurum/kvkk", label: "KVKK", requiredCapability: "privacy:manage" },
      { href: "/kurum/guvenlik-denetimi", label: "Güvenlik Denetimi", requiredCapability: "security:read" },
      { href: "/kurum/gozlemlenebilirlik", label: "Gözlemlenebilirlik", requiredCapability: "observability:read" },
      { href: "/kurum/uat-rollback", label: "UAT / Rollback", requiredCapability: "operation:manage" },
      { href: "/kurum/canli-yayin", label: "Canlı Yayın", requiredCapability: "operation:manage" },
      { href: "/kurum/sistem-sagligi", label: "Sistem Sağlığı", requiredCapability: "observability:read" },
      { href: "/kurum/yedek-restore", label: "Yedek / Restore", requiredCapability: "operation:manage" },
    ],
  },
];

export const systemNavGroups: readonly SystemNavGroup[] = [
  {
    label: "Sistem",
    items: [{ href: "/sistem", label: "Sistem Paneli" }],
  },
  {
    label: "Kurumlar",
    items: [{ href: "/sistem/kurumlar", label: "Kurumlar" }],
  },
  {
    label: "İzleme",
    items: [
      { href: "/sistem/sistem-sagligi", label: "Sistem Sağlığı" },
      { href: "/sistem/gozlemlenebilirlik", label: "Gözlemlenebilirlik" },
      { href: "/sistem/denetim", label: "Denetim" },
    ],
  },
];

export const rolePortalItems: readonly RolePortalItem[] = [
  { href: "/ogretmen", label: "Öğretmen Portalı", role: "TEACHER", subjectType: "TEACHER" },
  { href: "/ogrenci", label: "Öğrenci Portalı", role: "STUDENT", subjectType: "STUDENT" },
  { href: "/veli", label: "Veli Portalı", role: "GUARDIAN", subjectType: "GUARDIAN" },
];

export const staticBreadcrumbLabels: Record<string, string> = {
  "/": "Ana Sayfa",
  "/sistem": "Sistem",
  "/sistem/kurumlar": "Kurumlar",
  "/sistem/sistem-sagligi": "Sistem Sağlığı",
  "/sistem/gozlemlenebilirlik": "Gözlemlenebilirlik",
  "/sistem/denetim": "Denetim",
  "/kurum": "Kurum",
  "/kurum/kurulum": "Kurulum",
  "/ogretmen": "Öğretmen Portalı",
  "/ogrenci": "Öğrenci Portalı",
  "/veli": "Veli Portalı",
  "/kurum/akademik-takvim": "Akademik Takvim",
  "/kurum/canli-yayin": "Canlı Yayın",
  "/kurum/denetim": "Denetim",
  "/kurum/dersler": "Dersler",
  "/kurum/destek": "Destek",
  "/kurum/devamsizlik": "Devamsızlık",
  "/kurum/duyurular": "Duyurular",
  "/kurum/etutler": "Etütler",
  "/kurum/finans": "Finans",
  "/kurum/gozlemlenebilirlik": "Gözlemlenebilirlik",
  "/kurum/guvenlik-denetimi": "Güvenlik Denetimi",
  "/kurum/kampusler": "Kampüsler",
  "/kurum/kazanimlar": "Kazanımlar",
  "/kurum/kullanicilar": "Kullanıcılar",
  "/kurum/kvkk": "KVKK",
  "/kurum/materyaller": "Materyaller",
  "/kurum/notlar": "Öğretmen Notları",
  "/kurum/ogrenciler": "Öğrenciler",
  "/kurum/ogretmenler": "Öğretmenler",
  "/kurum/optik": "Optik",
  "/kurum/program": "Ders Programı",
  "/kurum/raporlar": "Raporlar",
  "/kurum/rol-onizleme": "Rol Önizleme",
  "/kurum/seviyeler": "Seviyeler",
  "/kurum/sinavlar": "Sınavlar",
  "/kurum/siniflar": "Sınıflar",
  "/kurum/sistem-sagligi": "Sistem Sağlığı",
  "/kurum/sablonlar": "Şablonlar",
  "/kurum/uat-rollback": "UAT / Rollback",
  "/kurum/veliler": "Veliler",
  "/kurum/yedek-restore": "Yedek / Restore",
};

export const dynamicDetailParents: string[] = ["ogrenciler", "ogretmenler", "veliler", "siniflar", "duyurular"];
