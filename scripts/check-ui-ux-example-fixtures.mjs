import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const exampleRoot = resolve("ornek-veriler");
const expectedFixtures = [
  {
    label: "iSEM LGS 1",
    answerKey: "iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx",
    txt: "iSEM .txt",
    expectedRows: 21,
  },
  {
    label: "3D PROVA LGS 2",
    answerKey: "3D - PROVA LGS - 2 Detaylı Cevap Anahtarı.xlsx",
    txt: "3D.txt",
    expectedRows: 21,
  },
  {
    label: "MUBA LGS 3",
    answerKey: "MUBA - LGS - 3 Detaylı Cevap Anahtarı.xlsx",
    txt: "MUBA.txt",
    expectedRows: 21,
  },
];
const importTemplates = ["ogrenci-aktarim-sablonu.xlsx", "ogretmen-aktarim-sablonu.xlsx"];
const failures = [];
const seen = new Map();
let opticalRows = 0;

if (!existsSync(exampleRoot)) {
  failures.push("ornek-veriler dizini bulunamadı.");
} else if (lstatSync(exampleRoot).isSymbolicLink() || !lstatSync(exampleRoot).isDirectory()) {
  failures.push("ornek-veriler symlink olmayan dizin olmalı.");
}

for (const fixture of expectedFixtures) {
  const txtPath = resolve(exampleRoot, fixture.txt);
  const answerKeyPath = resolve(exampleRoot, fixture.answerKey);

  requireRegularFile(txtPath, `${fixture.label} TXT`, 1000);
  requireRegularFile(answerKeyPath, `${fixture.label} cevap anahtarı`, 1000);
  requireXlsxZip(answerKeyPath, `${fixture.label} cevap anahtarı`);
  opticalRows += requireOpticalRows(txtPath, fixture.label, fixture.expectedRows);

  remember(txtPath);
  remember(answerKeyPath);
}

for (const template of importTemplates) {
  const templatePath = resolve(exampleRoot, template);
  requireRegularFile(templatePath, template, 1000);
  requireXlsxZip(templatePath, template);
  remember(templatePath);
}

if (failures.length > 0) {
  console.error("UI/UX örnek fixture kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI/UX örnek fixture kontrolü geçti: ${seen.size} dosya, ${opticalRows} optik satır.`);

function requireRegularFile(filePath, label, minBytes) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    failures.push(`${label} bulunamadı: ${filePath}`);
    return;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    failures.push(`${label} symlink olmayan dosya olmalı.`);
    return;
  }

  if (stat.size < minBytes) {
    failures.push(`${label} beklenenden küçük: ${stat.size} byte.`);
  }
}

function requireXlsxZip(filePath, label) {
  if (!existsSync(filePath)) return;
  const header = readFileSync(filePath).subarray(0, 4).toString("hex");
  if (header !== "504b0304") {
    failures.push(`${label} xlsx zip başlığı taşımıyor.`);
  }
}

function requireOpticalRows(filePath, label, expectedRows) {
  if (!existsSync(filePath)) return 0;
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length !== expectedRows) {
    failures.push(`${label} optik satır sayısı ${expectedRows} olmalı, bulundu: ${lines.length}.`);
  }

  for (const [index, line] of lines.entries()) {
    if (line.length < 100) {
      failures.push(`${label} optik satırı kısa görünüyor: ${index + 1}.`);
      break;
    }
  }

  return lines.length;
}

function remember(filePath) {
  if (!existsSync(filePath)) return;
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  seen.set(filePath, digest);
}
