type InstitutionNavigationItem = {
  href: string;
  label: string;
};

type InstitutionNavGroup = {
  label: string;
  items: InstitutionNavigationItem[];
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
    items: [{ href: "/kurum", label: "Genel Bakış" }],
  },
  {
    label: "Kişiler",
    items: [
      { href: "/kurum/ogrenciler", label: "Öğrenciler" },
      { href: "/kurum/veliler", label: "Veliler" },
      { href: "/kurum/ogretmenler", label: "Öğretmenler" },
    ],
  },
  {
    label: "Akademik",
    items: [
      { href: "/kurum/kampusler", label: "Kampüsler" },
      { href: "/kurum/akademik-takvim", label: "Akademik Takvim" },
      { href: "/kurum/seviyeler", label: "Seviyeler" },
      { href: "/kurum/siniflar", label: "Sınıflar" },
      { href: "/kurum/dersler", label: "Dersler" },
      { href: "/kurum/program", label: "Ders Programı" },
      { href: "/kurum/etutler", label: "Etütler" },
      { href: "/kurum/devamsizlik", label: "Devamsızlık" },
      { href: "/kurum/notlar", label: "Öğretmen Notları" },
      { href: "/kurum/materyaller", label: "Materyaller" },
    ],
  },
  {
    label: "Sınav ve Rapor",
    items: [
      { href: "/kurum/sinavlar", label: "Sınavlar" },
      { href: "/kurum/optik", label: "Optik" },
      { href: "/kurum/raporlar", label: "Raporlar" },
    ],
  },
  {
    label: "Finans",
    items: [{ href: "/kurum/finans", label: "Ödemeler" }],
  },
  {
    label: "İletişim",
    items: [
      { href: "/kurum/duyurular", label: "Duyurular" },
      { href: "/kurum/sablonlar", label: "Şablonlar" },
      { href: "/kurum/destek", label: "Destek" },
    ],
  },
  {
    label: "Operasyon",
    items: [
      { href: "/kurum/kullanicilar", label: "Kullanıcılar" },
      { href: "/kurum/rol-onizleme", label: "Rol Önizleme" },
      { href: "/kurum/denetim", label: "Denetim" },
      { href: "/kurum/kvkk", label: "KVKK" },
      { href: "/kurum/guvenlik-denetimi", label: "Güvenlik Denetimi" },
      { href: "/kurum/gozlemlenebilirlik", label: "Gözlemlenebilirlik" },
      { href: "/kurum/uat-rollback", label: "UAT / Rollback" },
      { href: "/kurum/canli-yayin", label: "Canlı Yayın" },
      { href: "/kurum/sistem-sagligi", label: "Sistem Sağlığı" },
      { href: "/kurum/yedek-restore", label: "Yedek / Restore" },
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
  "/kurum": "Kurum",
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

export const dynamicDetailParents: string[] = ["ogrenciler", "ogretmenler", "duyurular"];
