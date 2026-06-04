import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const webAppRoot = "apps/web/app";
const sourceRoots = ["apps/web/app", "apps/web/src"];
const outputTarget = process.env.WEB_PERFORMANCE_PROFILE_OUT;

const sourceFiles = sourceRoots.flatMap((root) => listFiles(root));
const sourceFileSet = new Set(sourceFiles);
const pageFiles = sourceFiles.filter((file) => file.endsWith(`${sep}page.tsx`));
const componentFiles = sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file));
const routeProfiles = pageFiles.map(profileRoute).sort((a, b) => a.route.localeCompare(b.route));
const queryProfiles = componentFiles.map(profileQueries).filter((profile) => profile.useQueryCalls > 0);
const queryKeyUsage = countQueryKeys(queryProfiles);

const profile = {
  generatedAt: new Date().toISOString(),
  profileVersion: "2026.06.web-static-v1",
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

if (outputTarget) {
  mkdirSync(dirname(outputTarget), { recursive: true });
  writeFileSync(outputTarget, `${JSON.stringify(profile, null, 2)}\n`);
}

console.log(JSON.stringify(profile, null, 2));

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
