import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/web/src", "apps/web/app", "apps/web/e2e-next"];
const forbidden = [/\blocalStorage\b/, /\bsessionStorage\b/];
const failures = [];

for (const root of roots) {
  for (const file of listFiles(root)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        failures.push(`${file}: ${pattern.source}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Web token storage kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web token storage kontrolü geçti: localStorage/sessionStorage kullanımı yok.");

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}
