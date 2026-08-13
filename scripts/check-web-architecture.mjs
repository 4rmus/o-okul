import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import ts from "typescript";

const controlPlanePresentationImports = [
  "/kurum/_shared/evidence-panels.js",
  "/kurum/_shared/operation-summary.js",
  "/kurum/_shared/page-frame.js",
];
const controlPlanePresentationSources = controlPlanePresentationImports
  .map((suffix) => suffix.replace(/\.js$/, ".tsx"));
const failures = [];
const sourceRoots = ["apps/web/app", "apps/web/src", "apps/web/features", "packages/ui/src"];
for (const root of sourceRoots) {
  for (const file of listSourceFiles(root)) failures.push(...validateFile(file, readFileSync(file, "utf8")));
}

const negativeFixtures = [
  ["packages/ui/src/invalid.ts", 'import "../../../apps/web/src/api-client.js";'],
  ["apps/web/features/students/client.tsx", '"use client";\nimport { headers } from "next/headers";'],
  ["apps/web/features/students/internal.ts", 'import "../reports/internal.js";'],
  ["apps/web/features/students/dynamic.ts", 'await import("../reports/internal.js");'],
  ["apps/web/features/students/legacy.ts", 'require("../reports/internal.js");'],
  ["apps/web/features/students/dynamic-variable.ts", "await import(moduleName);"],
  ["apps/web/features/students/legacy-variable.ts", "require(moduleName);"],
  ["apps/web/src/invalid.ts", 'import "../features/students/index.js";'],
  ["apps/web/features/students/app-import.ts", 'import "../../app/kurum/page.js";'],
  ["apps/web/app/(app)/sistem/invalid.ts", 'import "../kurum/ogrenciler/students-page.js";'],
  ["apps/web/app/(app)/sistem/portal.ts", 'import "../portals/student-portal-page.js";'],
  ["apps/web/app/page.tsx", 'import "../src/api-client.js";'],
  ["apps/web/app/(app)/portals/admin.ts", 'import "../sistem/_shared/system-api.js";'],
  ["apps/web/app/(app)/portals/tenant-command.ts", 'import "../kurum/ogrenciler/students-page.js";'],
  ["apps/web/app/(app)/client-secret.tsx", '"use client";\nconst value = process.env.FEATURE_ROLLOUTS_JSON;'],
  [
    "apps/web/app/(app)/kurum/_shared/page-frame.tsx",
    'import "@/src/api-client.js";',
  ],
];
for (const [file, source] of negativeFixtures) {
  if (validateFile(file, source).length === 0) failures.push("negative architecture fixture kabul edildi: " + file);
}

if (failures.length > 0) {
  console.error("Web architecture kontrolü başarısız:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}
console.log("Web architecture kontrolü geçti.");

function validateFile(file, source) {
  const output = [];
  const normalized = normalize(file);
  const sourceLayer = architectureLayer(normalized);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const { imports, nonLiteralCalls } = collectImportSpecifiers(sourceFile);
  for (const call of nonLiteralCalls) {
    output.push(file + ": " + call + " yalnız literal modül yolu kullanmalı");
  }

  for (const specifier of imports) {
    const target = resolveImportTarget(file, specifier);
    const targetLayer = architectureLayer(target);
    if (sourceLayer !== undefined && targetLayer !== undefined && targetLayer > sourceLayer) {
      output.push(file + ": bağımlılık yönü app -> features -> shared -> packages/ui olmalı");
    }
  }

  if (normalized.includes("/packages/ui/")) {
    for (const specifier of imports) {
      const target = resolveImportTarget(file, specifier);
      if (target.includes("/apps/web/")) output.push(file + ": packages/ui apps/web import edemez");
    }
  }

  if (normalized.includes("apps/web/features/")) {
    const currentFeature = normalized.split("apps/web/features/")[1]?.split("/")[0];
    for (const specifier of imports) {
      const target = resolveImportTarget(file, specifier);
      const targetFeature = target.split("/apps/web/features/")[1]?.split("/")[0];
      const publicFeatureEntry = targetFeature
        ? new RegExp("/" + escapeRegExp(targetFeature) + "/index(?:\\.[cm]?[jt]sx?)?$").test(target)
        : false;
      if (targetFeature && targetFeature !== currentFeature && !publicFeatureEntry) {
        output.push(file + ": feature iç dosyası başka feature tarafından import edilemez");
      }
    }
  }

  if (normalized.includes("/apps/web/app/(app)/sistem/")) {
    for (const specifier of imports) {
      const target = resolveImportTarget(file, specifier);
      if (target.includes("/apps/web/app/(app)/portals/")) {
        output.push(file + ": control-plane portal implementasyonu import edemez");
      }
      if (
        target.includes("/apps/web/app/(app)/kurum/")
        && !controlPlanePresentationImports.some((suffix) => target.endsWith(suffix))
      ) {
        output.push(file + ": control-plane tenant route implementasyonu import edemez");
      }
    }
  }

  if (controlPlanePresentationSources.some((suffix) => normalized.endsWith(suffix))) {
    for (const specifier of imports) {
      if (!isSafeControlPlanePresentationImport(specifier)) {
        output.push(file + ": control-plane sunum allowlist'i tenant/API/session bağımlılığı alamaz");
      }
    }
  }

  if (isMarketingSource(normalized)) {
    for (const specifier of imports) {
      const target = resolveImportTarget(file, specifier);
      if (target.includes("/apps/web/src/api-client") || target.includes("/apps/web/app/(app)/")) {
        output.push(file + ": marketing production app/API yüzeyi import edemez");
      }
    }
  }

  if (isPortalSource(normalized)) {
    for (const specifier of imports) {
      const target = resolveImportTarget(file, specifier);
      if (target.includes("/apps/web/app/(app)/sistem/") || target.includes("/apps/web/app/(app)/kurum/")) {
        output.push(file + ": portal admin/control-plane implementasyonu import edemez");
      }
    }
  }

  const clientComponent = sourceFile.statements.some((statement, index) =>
    index === 0
    && ts.isExpressionStatement(statement)
    && ts.isStringLiteral(statement.expression)
    && statement.expression.text === "use client",
  );
  if (clientComponent) {
    for (const specifier of imports) {
      if (specifier === "next/headers" || specifier === "server-only" || specifier.startsWith("node:")) {
        output.push(file + ": client component server-only import içeriyor");
      }
    }
    if (/process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+/.test(source)) {
      output.push(file + ": client component private environment variable okuyor");
    }
  }
  return output;
}

function collectImportSpecifiers(sourceFile) {
  const imports = [];
  const nonLiteralCalls = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const callKind = node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? "dynamic import"
        : ts.isIdentifier(node.expression) && node.expression.text === "require"
          ? "require"
          : undefined;
      if (callKind && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        imports.push(node.arguments[0].text);
      } else if (callKind) {
        nonLiteralCalls.push(callKind);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { imports, nonLiteralCalls };
}

function resolveImportTarget(file, specifier) {
  if (specifier.startsWith(".")) return normalize(resolve(dirname(file), specifier));
  if (specifier.startsWith("@/")) return normalize(resolve("apps/web", specifier.slice(2)));
  if (specifier === "@o-okul/ui" || specifier.startsWith("@o-okul/ui/")) return normalize(resolve("packages/ui/src"));
  return "/external/" + specifier;
}

function architectureLayer(file) {
  if (file.includes("/apps/web/app/")) return 3;
  if (file.includes("/apps/web/features/")) return 2;
  if (file.includes("/apps/web/src/")) return 1;
  if (file.includes("/packages/ui/src/")) return 0;
  return undefined;
}

function normalize(path) {
  return resolve(path).split(sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMarketingSource(file) {
  return file.endsWith("/apps/web/app/page.tsx") || file.includes("/apps/web/app/iletisim/");
}

function isPortalSource(file) {
  return ["/portals/", "/ogrenci/", "/ogretmen/", "/veli/"]
    .some((segment) => file.includes("/apps/web/app/(app)" + segment));
}

function listSourceFiles(root) {
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink()) {
      failures.push(root + ": architecture source root symlink olamaz");
      return [];
    }
    const canonicalRoot = normalize(realpathSync(root));
    return listSourceFilesWithin(root, canonicalRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function listSourceFilesWithin(root, canonicalRoot) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      failures.push(path + ": architecture tarama ağacında symlink yasak");
      return [];
    }
    const canonicalPath = normalize(realpathSync(path));
    if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(canonicalRoot + "/")) {
      failures.push(path + ": architecture tarama kökü dışına çıkıyor");
      return [];
    }
    if (stat.isDirectory()) return listSourceFilesWithin(path, canonicalRoot);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function isSafeControlPlanePresentationImport(specifier) {
  return specifier === "react"
    || specifier.startsWith("react/")
    || specifier === "@o-okul/ui"
    || specifier.startsWith("@o-okul/ui/")
    || specifier === "@o-okul/shared-types"
    || specifier.startsWith("@o-okul/shared-types/");
}
