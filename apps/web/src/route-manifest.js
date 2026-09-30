// Runtime route manifest (UI-02, ADR-0005 Berrak güncellemesi): navigation, breadcrumb, komut paleti
// ve hub sekmeleri bu dosyadan türetilir. Düz JS kalır; hem Next hem node check script'leri import eder.
// Frontend ön kontrolüdür; backend capability ve tenant/scope guard'ının yerine geçmez.

export const routeFamilies = [
  "MARKETING",
  "AUTH",
  "TENANT_DASHBOARD",
  "REGISTRY",
  "WORKFLOW",
  "MASTER_DETAIL",
  "PORTAL",
  "CONTROL_PLANE",
];

export const routeBoundaries = [
  "PUBLIC",
  "AUTHENTICATED_SELF",
  "TENANT",
  "PORTAL_SELF",
  "CONTROL_PLANE",
  "TRANSITIONAL_GUARDIAN",
];

export const moduleDecisions = [
  moduleDecision("marketing", "frontend_ux_engineer", "reuse"),
  moduleDecision("auth", "auth_session_engineer", "refactor"),
  moduleDecision("account", "auth_session_engineer", "reuse"),
  moduleDecision("shell", "frontend_ux_engineer", "split"),
  moduleDecision("setup", "frontend_ux_engineer", "refactor"),
  moduleDecision("students", "frontend_ux_engineer", "split"),
  moduleDecision("identity", "backend_api_engineer", "split"),
  moduleDecision("academic-structure", "backend_api_engineer", "split"),
  moduleDecision("attendance", "backend_api_engineer", "refactor"),
  moduleDecision("exam", "exam_reporting_engineer", "split"),
  moduleDecision("optical", "exam_reporting_engineer", "refactor"),
  moduleDecision("report", "exam_reporting_engineer", "split"),
  moduleDecision("communication", "messaging_integrations_engineer", "refactor"),
  moduleDecision("finance", "backend_api_engineer", "split"),
  moduleDecision("operations", "ops_release_engineer", "reuse"),
  moduleDecision("teacher-portal", "frontend_ux_engineer", "split"),
  moduleDecision("student-portal", "frontend_ux_engineer", "split"),
  moduleDecision("guardian-portal", "frontend_ux_engineer", "retire"),
  moduleDecision("control-plane", "ops_release_engineer", "split"),
];

const decisionByModule = new Map(moduleDecisions.map((entry) => [entry.module, entry]));
const tenantModules = {
  "akademik-takvim": ["academic-structure", "REGISTRY"],
  calisanlar: ["identity", "REGISTRY"],
  "canli-yayin": ["operations", "WORKFLOW"],
  denetim: ["operations", "REGISTRY"],
  dersler: ["academic-structure", "REGISTRY"],
  destek: ["communication", "MASTER_DETAIL"],
  devamsizlik: ["attendance", "WORKFLOW"],
  duyurular: ["communication", "REGISTRY"],
  etutler: ["academic-structure", "REGISTRY"],
  finans: ["finance", "MASTER_DETAIL"],
  "guvenlik-denetimi": ["operations", "WORKFLOW"],
  kampusler: ["academic-structure", "REGISTRY"],
  kazanimlar: ["academic-structure", "REGISTRY"],
  kullanicilar: ["identity", "REGISTRY"],
  "lisans-donemleri": ["setup", "REGISTRY"],
  kurulum: ["setup", "WORKFLOW"],
  kvkk: ["operations", "WORKFLOW"],
  materyaller: ["academic-structure", "REGISTRY"],
  notlar: ["academic-structure", "REGISTRY"],
  "ogrenci-portal-erisimi": ["identity", "REGISTRY"],
  ogrenciler: ["students", "REGISTRY"],
  ogretmenler: ["identity", "REGISTRY"],
  optik: ["optical", "WORKFLOW"],
  "operasyon-ve-kanit": ["operations", "WORKFLOW"],
  program: ["academic-structure", "REGISTRY"],
  raporlar: ["report", "WORKFLOW"],
  "rol-onizleme": ["identity", "WORKFLOW"],
  sablonlar: ["communication", "REGISTRY"],
  seviyeler: ["academic-structure", "REGISTRY"],
  sinavlar: ["exam", "REGISTRY"],
  siniflar: ["academic-structure", "REGISTRY"],
  veliler: ["guardian-portal", "REGISTRY"],
  "yedek-restore": ["operations", "WORKFLOW"],
};

const authRoutes = new Set([
  "/k/[tenantSlug]/giris",
  "/giris",
  "/login",
  "/aktivasyon",
  "/parola-sifirla",
  "/parolami-unuttum",
]);

export function resolveRouteArchitecture(routeTemplate) {
  if (routeTemplate === "/" || routeTemplate === "/iletisim") {
    return architecture("MARKETING", "marketing", "PUBLIC");
  }
  if (authRoutes.has(routeTemplate)) {
    return architecture("AUTH", "auth", "PUBLIC");
  }
  if (routeTemplate === "/sifre-degistir") {
    return architecture("AUTH", "auth", "AUTHENTICATED_SELF");
  }
  if (routeTemplate === "/sistem/giris") {
    return architecture("AUTH", "auth", "CONTROL_PLANE");
  }
  if (routeTemplate === "/hesap/oturumlar") {
    return architecture("WORKFLOW", "account", "TENANT");
  }
  if (routeTemplate === "/kurum") {
    return architecture("TENANT_DASHBOARD", "shell", "TENANT");
  }
  if (routeTemplate.startsWith("/kurum/")) {
    const segment = routeTemplate.split("/")[2];
    const rule = tenantModules[segment];
    if (!rule) throw new Error("ROUTE_ARCHITECTURE_MISSING:" + routeTemplate);
    const [module, indexFamily] = rule;
    const family = routeTemplate.includes("[") ? "MASTER_DETAIL" : indexFamily;
    const boundary = segment === "veliler" ? "TRANSITIONAL_GUARDIAN" : "TENANT";
    return architecture(family, module, boundary);
  }
  if (routeTemplate === "/sistem" || routeTemplate.startsWith("/sistem/")) {
    return architecture("CONTROL_PLANE", "control-plane", "CONTROL_PLANE");
  }
  if (routeTemplate === "/ogretmen" || routeTemplate.startsWith("/ogretmen/")) {
    return architecture("PORTAL", "teacher-portal", "PORTAL_SELF");
  }
  if (routeTemplate === "/ogrenci" || routeTemplate.startsWith("/ogrenci/")) {
    return architecture("PORTAL", "student-portal", "PORTAL_SELF");
  }
  if (routeTemplate === "/veli" || routeTemplate.startsWith("/veli/")) {
    return architecture("PORTAL", "guardian-portal", "TRANSITIONAL_GUARDIAN");
  }
  throw new Error("ROUTE_ARCHITECTURE_MISSING:" + routeTemplate);
}

function architecture(family, module, boundary) {
  const decision = decisionByModule.get(module);
  if (!decision) throw new Error("ROUTE_MODULE_DECISION_MISSING:" + module);
  return { boundary, decision: decision.decision, family, module, owner: decision.owner };
}

function moduleDecision(module, owner, decision) {
  return { decision, module, owner };
}

const operationEvidenceCapability = "operation:manage";

// Kurum paneli: grup sırası ve grup içi sıra menü sırasıdır. `hub` kardeş sayfaların hub kökünü gösterir (G5).
export const institutionNavGroupLabels = ["Bugün", "Kişiler", "Akademik", "Sınav", "İletişim", "Finans", "Ayarlar"];

export const institutionRoutes = [
  navRoute("/kurum", "Özet", "Bugün", "LayoutDashboard", { breadcrumbLabel: "Kurum Özeti" }),
  navRoute("/kurum/ogrenciler", "Öğrenciler", "Kişiler", "GraduationCap", { capability: "student:manage", detailParent: true, hub: "/kurum/ogrenciler", tabLabel: "Liste" }),
  navRoute("/kurum/veliler", "Veli kayıtları", "Kişiler", "Users", { capability: "student:manage", detailParent: true, hub: "/kurum/ogrenciler" }),
  navRoute("/kurum/ogretmenler", "Öğretmenler", "Kişiler", "UserRoundCog", { capability: "staff:manage", detailParent: true, hub: "/kurum/ogretmenler", menuLabel: "Personel" }),
  navRoute("/kurum/calisanlar", "Çalışanlar ve Yetkiler", "Kişiler", "UserRoundCog", { capability: "user:manage", hub: "/kurum/ogretmenler", tabLabel: "Çalışanlar ve yetkiler" }),
  navRoute("/kurum/ogrenci-portal-erisimi", "Öğrenci Portal Erişimi", "Kişiler", "GraduationCap", { capability: "user:manage", hub: "/kurum/ogrenciler", tabLabel: "Portal erişimi" }),
  navRoute("/kurum/kullanicilar", "Kullanıcılar", "Kişiler", "Users", { capability: "user:manage", hub: "/kurum/ogretmenler", tabLabel: "Kullanıcı hesapları" }),
  navRoute("/kurum/siniflar", "Sınıflar", "Akademik", "School", { capability: "class:manage", detailParent: true, hub: "/kurum/siniflar", menuLabel: "Sınıf yapısı" }),
  navRoute("/kurum/seviyeler", "Seviyeler", "Akademik", "ClipboardList", { capability: "class:manage", hub: "/kurum/siniflar" }),
  navRoute("/kurum/kampusler", "Kampüsler", "Akademik", "Building2", { capability: "class:manage", hub: "/kurum/siniflar" }),
  navRoute("/kurum/dersler", "Dersler", "Akademik", "BookOpen", { capability: "academic:manage", hub: "/kurum/dersler", menuLabel: "Ders ve program" }),
  navRoute("/kurum/program", "Program", "Akademik", "CalendarDays", { capability: "academic:manage", hub: "/kurum/dersler", tabLabel: "Haftalık program" }),
  navRoute("/kurum/etutler", "Etütler", "Akademik", "NotebookTabs", { capability: "academic:manage", hub: "/kurum/dersler" }),
  navRoute("/kurum/devamsizlik", "Devamsızlık", "Akademik", "ClipboardCheck", { capability: "attendance:manage", keywords: ["yoklama"], menuLabel: "Yoklama" }),
  navRoute("/kurum/akademik-takvim", "Takvim", "Akademik", "CalendarDays", { capability: "academic:manage" }),
  navRoute("/kurum/materyaller", "Materyaller", "Akademik", "Library", { capability: "academic:manage", keywords: ["ödev"], menuLabel: "Ödev ve materyal" }),
  navRoute("/kurum/notlar", "Notlar", "Akademik", "NotebookTabs", { capability: "note:manage" }),
  navRoute("/kurum/sinavlar", "Sınavlar", "Sınav", "FileText", { capability: "academic:manage", detailParent: true }),
  navRoute("/kurum/raporlar", "Sınav Raporları", "Sınav", "BarChart3", { capability: "academic:manage", keywords: ["karne"], menuLabel: "Raporlar" }),
  navRoute("/kurum/kazanimlar", "Kazanımlar", "Sınav", "ClipboardList", { capability: "academic:manage" }),
  // Optik okuma menüden çıktı; sınav çalışma alanından açılır (§4).
  navRoute("/kurum/optik", "Optik Okuma", "Sınav", "ScanLine", { capability: "academic:manage", hiddenFromRail: true }),
  navRoute("/kurum/duyurular", "Duyurular", "İletişim", "Megaphone", { capability: "announcement:manage", detailParent: true, hub: "/kurum/duyurular" }),
  navRoute("/kurum/sablonlar", "Mesaj Şablonları", "İletişim", "MessageSquareText", { capability: "announcement:manage", hub: "/kurum/duyurular", requiresSms: true, tabLabel: "Mesaj şablonları" }),
  navRoute("/kurum/destek", "Kurum içi destek", "İletişim", "LifeBuoy", { capability: "support:manage", menuLabel: "Destek" }),
  navRoute("/kurum/finans", "Ödeme planları", "Finans", "CreditCard", { breadcrumbLabel: "Finans", capability: "finance:manage" }),
  navRoute("/kurum/kurulum", "Kurulum", "Ayarlar", "Settings", { capability: "setup:manage" }),
  navRoute("/kurum/lisans-donemleri", "Lisans Dönemleri", "Ayarlar", "ClipboardCheck", { capability: "setup:manage" }),
  navRoute("/kurum/rol-onizleme", "Rol Önizleme", "Ayarlar", "ShieldCheck", { capability: "role-preview:manage" }),
  navRoute("/kurum/operasyon-ve-kanit", "Operasyon ve kanıt", "Ayarlar", "ShieldCheck", { capability: operationEvidenceCapability, hub: "/kurum/operasyon-ve-kanit", tabLabel: "Genel bakış" }),
  navRoute("/kurum/yedek-restore", "Yedekleme", "Ayarlar", "Activity", { capability: "operation:manage", hiddenFromRail: true, hub: "/kurum/operasyon-ve-kanit", operationEvidence: true }),
  navRoute("/kurum/kvkk", "KVKK", "Ayarlar", "ShieldCheck", { capability: "privacy:manage", hiddenFromRail: true, hub: "/kurum/operasyon-ve-kanit", operationEvidence: true }),
  navRoute("/kurum/denetim", "Denetim", "Ayarlar", "ClipboardList", { capability: "tenant-audit:read", hiddenFromRail: true, hub: "/kurum/operasyon-ve-kanit", operationEvidence: true, persona: "STAFF" }),
  navRoute("/kurum/guvenlik-denetimi", "Güvenlik Denetimi", "Ayarlar", "ShieldCheck", { capability: operationEvidenceCapability, hiddenFromRail: true, hub: "/kurum/operasyon-ve-kanit", operationEvidence: true, tabLabel: "Güvenlik denetimi" }),
  navRoute("/kurum/canli-yayin", "Yayın Hazırlığı", "Ayarlar", "Activity", { capability: operationEvidenceCapability, hiddenFromRail: true, hub: "/kurum/operasyon-ve-kanit", operationEvidence: true, tabLabel: "Yayın hazırlığı" }),
];

export const systemRoutes = [
  navRoute("/sistem", "Özet", "Başlangıç", "LayoutDashboard", { breadcrumbLabel: "Sistem Özeti" }),
  navRoute("/sistem/kurumlar", "Kurumlar", "Başlangıç", "Building2"),
  navRoute("/sistem/sistem-sagligi", "Sağlık", "İzleme", "Activity"),
  navRoute("/sistem/gozlemlenebilirlik", "Gözlem", "İzleme", "BarChart3"),
  navRoute("/sistem/denetim", "Denetim", "İzleme", "ClipboardList"),
];

export const portalHomeRoutes = [
  { href: "/ogretmen", iconName: "UserRoundCog", label: "Öğretmen Portalı", role: "TEACHER", subjectType: "TEACHER" },
  { href: "/ogrenci", iconName: "GraduationCap", label: "Öğrenci Portalı", role: "STUDENT", subjectType: "STUDENT" },
  { href: "/veli", iconName: "Users", label: "Veli Portalı", role: "GUARDIAN", subjectType: "GUARDIAN" },
];

export const portalNavGroups = [
  {
    label: "Öğretmen Paneli",
    role: "TEACHER",
    subjectType: "TEACHER",
    routes: [
      navRoute("/ogretmen", "Özet", "Öğretmen Paneli", "LayoutDashboard"),
      navRoute("/ogretmen/ders-akisi", "Ders Akışı", "Öğretmen Paneli", "CalendarDays"),
      navRoute("/ogretmen/ogrenci-takibi", "Öğrenci Takibi", "Öğretmen Paneli", "GraduationCap"),
      navRoute("/ogretmen/odevler", "Ödev Kontrolü", "Öğretmen Paneli", "NotebookTabs"),
      navRoute("/ogretmen/raporlar", "Sınav Raporu", "Öğretmen Paneli", "BarChart3"),
      navRoute("/ogretmen/duyurular", "Duyurular", "Öğretmen Paneli", "Megaphone"),
      navRoute("/ogretmen/destek", "Kurum içi destek", "Öğretmen Paneli", "LifeBuoy"),
    ],
  },
  {
    label: "Öğrenci Paneli",
    role: "STUDENT",
    subjectType: "STUDENT",
    routes: [
      navRoute("/ogrenci", "Özet", "Öğrenci Paneli", "LayoutDashboard"),
      navRoute("/ogrenci/raporlar", "Sınav Raporu", "Öğrenci Paneli", "BarChart3"),
      navRoute("/ogrenci/odevler", "Ödevler", "Öğrenci Paneli", "NotebookTabs"),
      navRoute("/ogrenci/duyurular", "Duyurular", "Öğrenci Paneli", "Megaphone"),
      navRoute("/ogrenci/devamsizlik", "Devamsızlık", "Öğrenci Paneli", "ClipboardCheck"),
      navRoute("/ogrenci/profil", "Profil", "Öğrenci Paneli", "GraduationCap"),
      navRoute("/ogrenci/destek", "Kurum içi destek", "Öğrenci Paneli", "LifeBuoy"),
    ],
  },
  {
    label: "Veli Paneli",
    role: "GUARDIAN",
    subjectType: "GUARDIAN",
    routes: [
      navRoute("/veli", "Özet", "Veli Paneli", "LayoutDashboard"),
      navRoute("/veli/ogrenci", "Öğrenci", "Veli Paneli", "GraduationCap"),
      navRoute("/veli/raporlar", "Sınav Raporu", "Veli Paneli", "BarChart3"),
      navRoute("/veli/odemeler", "Ödeme planları", "Veli Paneli", "CreditCard"),
      navRoute("/veli/odevler", "Ödevler", "Veli Paneli", "NotebookTabs"),
      navRoute("/veli/duyurular", "Duyurular", "Veli Paneli", "Megaphone"),
      navRoute("/veli/bildirimler", "Bildirimler", "Veli Paneli", "MessageSquareText"),
      navRoute("/veli/destek", "Kurum içi destek", "Veli Paneli", "LifeBuoy"),
    ],
  },
];

// Menüde olmayan ama breadcrumb'da kanonik etiketi olan yollar.
export const pageLabels = {
  "/": "Ana Sayfa",
  "/hesap": "Hesap",
  "/hesap/oturumlar": "Oturumlar",
  "/ogretmen": "Öğretmen Portalı",
  "/ogrenci": "Öğrenci Portalı",
  "/veli": "Veli Portalı",
};

// Komut paletindeki iş akışı ve hızlı işlem girdileri.
export const commandActions = [
  commandAction("/kurum/kurulum", "Yeni dönem açılışı", "İş akışı", "setup:manage"),
  commandAction("/kurum/raporlar", "Sınav sonrası kapanış", "İş akışı", "academic:manage"),
  commandAction("/kurum/kampusler?new=1", "Kampüs ekle", "Hızlı işlem", "class:manage"),
  commandAction("/kurum/seviyeler?new=1", "Seviye ekle", "Hızlı işlem", "class:manage"),
  commandAction("/kurum/siniflar?new=1", "Sınıf ekle", "Hızlı işlem", "class:manage"),
  commandAction("/kurum/dersler?new=1", "Ders ekle", "Hızlı işlem", "academic:manage"),
  commandAction("/kurum/ogretmenler?new=1", "Öğretmen ekle", "Hızlı işlem", "staff:manage"),
  commandAction("/kurum/ogrenciler?new=1", "Öğrenci ekle", "Hızlı işlem", "student:manage"),
  { ...commandAction("/sistem/kurumlar", "Kurum oluştur", "Hızlı işlem"), scope: "system" },
];

export function navigationRoutes() {
  return [...systemRoutes, ...institutionRoutes, ...portalNavGroups.flatMap((group) => group.routes)];
}

// Breadcrumb etiketleri: menü etiketi, üzerine breadcrumbLabel ve pageLabels.
export function breadcrumbLabels() {
  const labels = {};
  for (const route of [...systemRoutes, ...institutionRoutes, ...portalHomeRoutes, ...portalNavGroups.flatMap((group) => group.routes)]) {
    labels[route.href] = route.label;
  }
  for (const route of navigationRoutes()) {
    if (route.breadcrumbLabel) labels[route.href] = route.breadcrumbLabel;
  }
  return { ...labels, ...pageLabels };
}

// Hub modeli (§2): menüde her hub tek girdidir; kardeş sayfalar hub sekmesi olur. URL değişmez.
export function hubRoot(route) {
  return route.hub ? institutionRoutes.find((candidate) => candidate.href === route.hub) : undefined;
}

export function hubMembers(hubHref) {
  return institutionRoutes.filter((route) => route.hub === hubHref);
}

export function detailParentSegments() {
  return institutionRoutes.filter((route) => route.detailParent).map((route) => route.href.split("/")[2]);
}

function navRoute(href, label, group, iconName, options = {}) {
  return { group, href, iconName, label, ...options };
}

function commandAction(href, label, group, capability) {
  return { capability, group, href, label, scope: "institution" };
}
