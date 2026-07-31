import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

const webAppRoot = "apps/web/app";
const sourceRoots = ["apps/web/app", "apps/web/src"];
const outputTarget = process.env.WEB_PERFORMANCE_PROFILE_OUT;
const outputTempPathError = "WEB_PERFORMANCE_PROFILE_OUT lokal temp path olmamalı.";
const outputFileSymlinkError = "WEB_PERFORMANCE_PROFILE_OUT symlink olmayan file artifact olmalı.";
const outputParentSymlinkError = "WEB_PERFORMANCE_PROFILE_OUT parent dizini symlink olmayan dizin olmalı.";
const outputFile = outputTarget ? validateOutputTarget(outputTarget) : null;
const enforceBudget = process.env.WEB_PERFORMANCE_BUDGET === "1";
const landingPageSource = readFileSync("apps/web/app/page.tsx", "utf8");

const sourceFiles = sourceRoots.flatMap((root) => listFiles(root));
const sourceFileSet = new Set(sourceFiles);
const pageFiles = sourceFiles.filter((file) => file.endsWith(`${sep}page.tsx`));
const componentFiles = sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file));
const routeProfiles = pageFiles.map(profileRoute).sort((a, b) => a.route.localeCompare(b.route));
const queryProfiles = componentFiles.map(profileQueries).filter((profile) => profile.useQueryCalls > 0);
const queryKeyUsage = countQueryKeys(queryProfiles);
const assetBudgets = {
  landingHeroFallbackPng: publicAssetProfile("apps/web/public/images/landing-hero-education-ops.png", 2_000_000),
  landingHeroWebp: publicAssetProfile("apps/web/public/images/landing-hero-education-ops.webp", 250_000),
};
const budgetFailures = validateBudgets();

const profile = {
  generatedAt: new Date().toISOString(),
  profileVersion: "2026.06.web-static-v1",
  assetBudgets,
  totals: {
    clientComponents: componentFiles.filter(isClientComponent).length,
    institutionRoutes: routeProfiles.filter((route) => route.route.startsWith("/kurum")).length,
    pageRoutes: routeProfiles.length,
    queryFiles: queryProfiles.length,
    uniqueQueryKeys: queryKeyUsage.length,
    useQueryCalls: queryProfiles.reduce((total, profile) => total + profile.useQueryCalls, 0),
  },
  routeGroups: groupRoutes(routeProfiles),
  routeHotspots: routeProfiles
    .filter((route) => route.useQueryCalls >= 4)
    .map(({ route, useQueryCalls, queryKeys }) => ({ queryKeys, route, useQueryCalls })),
  queryKeyUsage,
  routes: routeProfiles,
};

if (outputFile) {
  mkdirSync(dirname(outputFile), { recursive: true });
  assertParentPathAllowed(dirname(outputFile));
  assertExistingFileArtifact(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(profile, null, 2)}\n`);
  assertExistingFileArtifact(outputFile);
}

console.log(JSON.stringify(profile, null, 2));

if (enforceBudget) {
  if (budgetFailures.length > 0) {
    console.error("Web performance budget kontrolü başarısız:");
    for (const failure of budgetFailures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.error("Web performance budget kontrolü geçti.");
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function profileRoute(file) {
  const routeFiles = collectLocalDependencies(file);
  const files = [...routeFiles];
  const queryKeys = [...new Set(files.flatMap((routeFile) => extractQueryKeys(readFileSync(routeFile, "utf8"))))].sort();
  return {
    clientEntry: isClientComponent(file),
    file,
    profiledFiles: files.length,
    queryKeys,
    route: toRoute(file),
    useQueryCalls: files.reduce((total, routeFile) => total + countMatches(readFileSync(routeFile, "utf8"), /\buseQuery\s*\(/g), 0),
  };
}

function publicAssetProfile(file, maxBytes) {
  return {
    file,
    maxBytes,
    sizeBytes: existsSync(file) ? statSync(file).size : null,
  };
}

function validateBudgets() {
  const failures = [];
  for (const asset of Object.values(assetBudgets)) {
    if (asset.sizeBytes === null) {
      failures.push(`${asset.file} eksik`);
      continue;
    }
    if (asset.sizeBytes > asset.maxBytes) {
      failures.push(`${asset.file} ${asset.sizeBytes} byte; bütçe ${asset.maxBytes} byte`);
    }
  }

  const landingRoute = routeProfiles.find((route) => route.route === "/");
  if (!landingRoute) {
    failures.push("Landing route profili bulunamadı.");
  } else {
    if (landingRoute.clientEntry) failures.push("Landing route server component kalmalı.");
    if (landingRoute.useQueryCalls !== 0) failures.push(`Landing route useQuery kullanmamalı: ${landingRoute.useQueryCalls}`);
  }

  const landingTokens = [
    "next-marketing-workflow",
    'aria-label="Örnek öğrenci gelişimi akışı"',
    "Sınavı sonuçlandırın",
    "Gelişimi karşılaştırın",
    "Desteği belirleyin",
    "Birlikte takip edin",
  ];
  for (const token of landingTokens) {
    if (!landingPageSource.includes(token)) {
      failures.push(`apps/web/app/page.tsx eksik: ${token}`);
    }
  }

  return failures;
}

function profileQueries(file) {
  const content = readFileSync(file, "utf8");
  return {
    file,
    queryKeys: extractQueryKeys(content),
    useMutationCalls: countMatches(content, /\buseMutation\s*\(/g),
    useQueryCalls: countMatches(content, /\buseQuery\s*\(/g),
  };
}

function extractQueryKeys(content) {
  const keys = [];
  const pattern = /queryKey:\s*\[\s*["']([^"']+)["']/g;
  let match = pattern.exec(content);
  while (match) {
    keys.push(match[1]);
    match = pattern.exec(content);
  }
  return [...new Set(keys)].sort();
}

function countQueryKeys(profiles) {
  const counts = new Map();
  for (const profile of profiles) {
    for (const queryKey of profile.queryKeys) {
      counts.set(queryKey, (counts.get(queryKey) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([queryKey, files]) => ({ files, queryKey }))
    .sort((a, b) => b.files - a.files || a.queryKey.localeCompare(b.queryKey));
}

function groupRoutes(routes) {
  return routes.reduce((groups, route) => {
    const group = route.route.split("/").filter(Boolean)[0] ?? "root";
    groups[group] = (groups[group] ?? 0) + 1;
    return groups;
  }, {});
}

function isClientComponent(file) {
  const content = readFileSync(file, "utf8");
  return content.startsWith("\"use client\";") || content.startsWith("'use client';");
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function toRoute(file) {
  const directory = dirname(relative(webAppRoot, file));
  if (directory === ".") return "/";
  const segments = directory
    .split(sep)
    .filter((segment) => segment && !segment.startsWith("("))
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function collectLocalDependencies(entryFile, seen = new Set()) {
  if (seen.has(entryFile)) return seen;
  seen.add(entryFile);
  const content = readFileSync(entryFile, "utf8");
  for (const specifier of localImportSpecifiers(content)) {
    const importedFile = resolveLocalImport(entryFile, specifier);
    if (importedFile) collectLocalDependencies(importedFile, seen);
  }
  return seen;
}

function localImportSpecifiers(content) {
  const specifiers = [];
  const pattern = /from\s+["'](\.[^"']+)["']/g;
  let match = pattern.exec(content);
  while (match) {
    specifiers.push(match[1]);
    match = pattern.exec(content);
  }
  return specifiers;
}

function resolveLocalImport(fromFile, specifier) {
  const base = join(dirname(fromFile), specifier).replace(/\.js$/, "");
  const candidates = [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")];
  return candidates.find((candidate) => sourceFileSet.has(candidate));
}

function validateOutputTarget(target) {
  const file = resolve(target);
  if (isLocalTempPath(file)) {
    fail(outputTempPathError);
  }

  assertParentPathAllowed(dirname(file));
  assertExistingFileArtifact(file);
  return file;
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(outputParentSymlinkError);
    }
  }
}

function assertExistingFileArtifact(file) {
  if (!existsSync(file)) return;

  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(outputFileSymlinkError);
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
