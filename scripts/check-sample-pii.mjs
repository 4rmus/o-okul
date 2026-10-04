import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

// KF-10 guard: no real T.C. kimlik or mobile number may enter the repository with a sample file or fixture.
// Test data uses the reserved fake ranges below; anything else fails with file:line and only the last 4 digits.
const fakeNationalId = /^1000000\d{4}$/;
const fictionalMobilePrefixes = ["555", "500"];
const allowedNumbers = new Map([
  ["5321234567", "apps/api/src/observability/sentry.test.ts: proves the Sentry scrubber redacts phone numbers"],
]);

const failures = [];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of files) {
  let content;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    content = readFileSync(file);
  } catch {
    continue;
  }
  if (content.includes(0)) continue;
  const lines = content.toString("utf8").split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(?<!\d)[1-9]\d{10}(?!\d)/g)) {
      const id = match[0];
      if (isValidNationalId(id) && !fakeNationalId.test(id) && !allowedNumbers.has(id)) {
        failures.push(`${file}:${index + 1}: T.C. kimlik geçerli numara (…${id.slice(-4)}); test için 1000000xxxx aralığını kullanın`);
      }
    }
    for (const match of line.matchAll(/(?<![\d#/=.\-])(?:\+90|0)?5\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g)) {
      const mobile = match[0].replace(/\D/g, "").replace(/^90/, "").replace(/^0/, "");
      if (mobile.length !== 10 || fictionalMobilePrefixes.includes(mobile.slice(0, 3)) || allowedNumbers.has(mobile)) continue;
      failures.push(`${file}:${index + 1}: cep telefonu (…${mobile.slice(-4)}); test için 555 veya 500 ile başlayan numara kullanın`);
    }
  });
}

if (failures.length > 0) {
  console.error("Örnek veri PII kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Örnek veri PII kontrolü geçti: ${files.length} izlenen dosya, gerçek T.C. kimlik veya cep telefonu yok.`);

function isValidNationalId(id) {
  const digits = [...id].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === digits[9]
    && digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10 === digits[10];
}
