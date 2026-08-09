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
  gozlemlenebilirlik: ["operations", "WORKFLOW"],
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
  "sistem-sagligi": ["operations", "WORKFLOW"],
  "uat-rollback": ["operations", "WORKFLOW"],
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
