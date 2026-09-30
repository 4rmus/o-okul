import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import {
  breadcrumbLabels,
  commandActions,
  institutionNavGroupLabels,
  institutionRoutes,
  moduleDecisions,
  navigationRoutes,
  portalHomeRoutes,
  resolveRouteArchitecture,
  routeBoundaries,
  routeFamilies,
} from "../apps/web/src/route-manifest.js";

const appRoot = "apps/web/app";
const smokePath = "apps/web/e2e-next/ui-route-family-smoke-next.spec.ts";
const failures = [];
const pageRoutes = collectPageRoutes(appRoot).sort();
const redirectedRetiredRoutes = ["/kurum/sistem-sagligi", "/kurum/gozlemlenebilirlik"];
const retiredRoutes = new Set(["/kurum/uat-rollback", ...redirectedRetiredRoutes]);
const smoke = readFileSync(smokePath, "utf8");
const start = smoke.indexOf("const routeCases = [");
const end = smoke.indexOf("] satisfies RouteCase[];", start);
const manifestSource = start >= 0 && end >= 0 ? smoke.slice(start, end) : "";
const manifestRoutes = [...manifestSource.matchAll(/^\s*route\("([^"]+)"/gm)].map((match) => match[1]).sort();
const manifestPersonas = new Map(
  [...manifestSource.matchAll(/^\s*route\("([^"]+)",\s*"[^"]+",\s*"([^"]+)"/gm)]
    .map((match) => [match[1], match[2]]),
);

if (JSON.stringify(pageRoutes) !== JSON.stringify(manifestRoutes)) {
  failures.push("route smoke manifest apps/web/app page.tsx envanteriyle eşleşmiyor");
}
if (new Set(manifestRoutes).size !== manifestRoutes.length) failures.push("route smoke manifest duplicate route içeriyor");
if (manifestPersonas.size !== pageRoutes.length) failures.push("route smoke persona envanteri eksik veya duplicate");
for (const route of retiredRoutes) {
  if (pageRoutes.includes(route) || manifestRoutes.includes(route)) failures.push("retired route yeniden eklenemez: " + route);
}
const nextConfig = readFileSync("apps/web/next.config.mjs", "utf8");
for (const route of redirectedRetiredRoutes) {
  if (!nextConfig.includes('"' + route + '"')) failures.push("emekli route için next.config.mjs yönlendirmesi eksik: " + route);
}

for (const route of pageRoutes) {
  try {
    const metadata = resolveRouteArchitecture(route);
    if (!routeFamilies.includes(metadata.family)) failures.push(route + ": family geçersiz");
    if (!routeBoundaries.includes(metadata.boundary)) failures.push(route + ": boundary geçersiz");
    if (!metadata.owner || !metadata.module) failures.push(route + ": owner/module eksik");
    if (route.startsWith("/veli") && metadata.boundary !== "TRANSITIONAL_GUARDIAN") {
      failures.push(route + ": guardian route transitional işaretlenmeli");
    }
    const persona = manifestPersonas.get(route);
    if (route === "/sistem/giris" && persona !== "anonymous") {
      failures.push(route + ": control-plane login anonymous persona taşımalı");
    }
    if (
      route === "/sifre-degistir"
      && (metadata.boundary !== "AUTHENTICATED_SELF" || persona !== "studentMustChangePassword")
    ) {
      failures.push(route + ": zorunlu parola değişimi authenticated self sınırı taşımalı");
    }
    if ((route === "/sistem" || (route.startsWith("/sistem/") && route !== "/sistem/giris")) && persona !== "systemAdmin") {
      failures.push(route + ": control-plane route systemAdmin persona taşımalı");
    }
    if ((route === "/kurum" || route.startsWith("/kurum/") || route.startsWith("/hesap/")) && persona === "systemAdmin") {
      failures.push(route + ": tenant route SYSTEM_ADMIN persona taşıyamaz");
    }
    for (const [prefix, expectedPersona] of [["/ogrenci", "student"], ["/ogretmen", "teacher"], ["/veli", "guardian"]]) {
      if ((route === prefix || route.startsWith(prefix + "/")) && persona !== expectedPersona) {
        failures.push(route + ": portal persona " + expectedPersona + " olmalı");
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

const moduleNames = moduleDecisions.map((entry) => entry.module);
if (new Set(moduleNames).size !== moduleNames.length) failures.push("module decision duplicate module içeriyor");
for (const entry of moduleDecisions) {
  if (!["reuse", "refactor", "split", "retire"].includes(entry.decision)) {
    failures.push(entry.module + ": module decision geçersiz");
  }
  if (!entry.owner) failures.push(entry.module + ": owner eksik");
}

// Runtime manifest (apps/web/src/route-manifest.js) navigation, breadcrumb, palette ve hub'ın tek kaynağıdır.
const runtimeRoutes = [...navigationRoutes(), ...portalHomeRoutes];
const runtimeHrefs = navigationRoutes().map((route) => route.href);
if (new Set(runtimeHrefs).size !== runtimeHrefs.length) failures.push("runtime manifest duplicate href içeriyor");
for (const route of runtimeRoutes) {
  if (!pageRoutes.includes(route.href)) failures.push("runtime manifest route'u page.tsx envanterinde yok: " + route.href);
  if (retiredRoutes.has(route.href)) failures.push("retired navigation route yeniden eklenemez: " + route.href);
  if (!route.label || !route.iconName) failures.push("runtime manifest label/iconName eksik: " + route.href);
}
for (const route of institutionRoutes) {
  if (!institutionNavGroupLabels.includes(route.group)) failures.push("kurum route grubu tanımsız: " + route.href);
  if (route.hub && !institutionRoutes.some((candidate) => candidate.href === route.hub)) {
    failures.push("hub kökü manifestte yok: " + route.href + " -> " + route.hub);
  }
  if (route.hub && route.hub !== route.href && institutionRoutes.find((candidate) => candidate.href === route.hub)?.hub !== route.hub) {
    failures.push("hub kökü kendi hub'ını taşımalı: " + route.hub);
  }
}
for (const action of commandActions) {
  const actionPath = action.href.split("?")[0];
  if (!pageRoutes.includes(actionPath)) failures.push("komut paleti hedefi page.tsx envanterinde yok: " + action.href);
}
for (const [file, pattern, label] of [
  ["apps/web/app/(app)/_shared/navigation.ts", /href:\s*"\//, "elle tutulan navigation href'i"],
  ["apps/web/app/(app)/_shared/navigation.ts", /staticBreadcrumbLabels[^=]*=\s*\{/, "elle tutulan breadcrumb haritası"],
  ["apps/web/app/(app)/app-shell.tsx", /commandItem\("\//, "elle tutulan komut paleti girdisi"],
]) {
  if (pattern.test(readFileSync(file, "utf8"))) failures.push(file + " " + label + " içeremez; apps/web/src/route-manifest.js kullanılmalı");
}
for (const [path, label] of Object.entries(breadcrumbLabels())) {
  if (!label) failures.push("breadcrumb etiketi boş: " + path);
}

if (failures.length > 0) {
  console.error("Route manifest kontrolü başarısız:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}
console.log("Route manifest kontrolü geçti: " + pageRoutes.length + " route, " + moduleDecisions.length + " module decision.");

function collectPageRoutes(root) {
  return listFiles(root)
    .filter((file) => file.endsWith(sep + "page.tsx"))
    .map((file) => {
      const directory = dirname(relative(root, file));
      if (directory === ".") return "/";
      const segments = directory.split(sep).filter((segment) => !segment.startsWith("("));
      return "/" + segments.join("/");
    });
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
