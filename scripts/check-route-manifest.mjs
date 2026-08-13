import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import {
  moduleDecisions,
  resolveRouteArchitecture,
  routeBoundaries,
  routeFamilies,
} from "../apps/web/e2e-next/route-architecture-manifest.js";

const appRoot = "apps/web/app";
const smokePath = "apps/web/e2e-next/ui-route-family-smoke-next.spec.ts";
const failures = [];
const pageRoutes = collectPageRoutes(appRoot).sort();
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

const navigation = readFileSync("apps/web/app/(app)/_shared/navigation.ts", "utf8");
const navigationRoutes = [...navigation.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
for (const route of navigationRoutes) {
  if (!pageRoutes.includes(route)) failures.push("navigation route manifestte yok: " + route);
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
