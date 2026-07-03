import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const exampleRoot = resolve("ornek-veriler");
const publicTemplateRoot = resolve("apps/web/public/templates");
const requireFromDb = createRequire(resolve("packages/db/package.json"));
const ExcelJS = requireFromDb("exceljs");
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
const importTemplates = [
  {
    file: "ogrenci-aktarim-sablonu.xlsx",
    sheet: "Ogrenciler",
    headers: [
      "okul_no",
      "ad",
      "soyad",
      "sinif",
      "email",
      "tc_kimlik_no",
      "telefon",
      "veli_ad",
      "veli_soyad",
      "veli_telefon",
      "veli_tc_kimlik_no",
    ],
    validateNationalIds: true,
  },
  {
    file: "ogretmen-aktarim-sablonu.xlsx",
    sheet: "Ogretmenler",
    headers: ["ad", "soyad", "brans", "tc_kimlik_no", "telefon"],
    validateNationalIds: true,
  },
  {
    file: "kazanim-aktarim-sablonu.xlsx",
    sheet: "Kazanimlar",
    headers: ["kod", "brans", "baslik", "seviye"],
  },
];
const failures = [];
const seen = new Map();
let opticalRows = 0;
const hasExampleRoot = existsSync(exampleRoot) && !lstatSync(exampleRoot).isSymbolicLink() && lstatSync(exampleRoot).isDirectory();

if (!existsSync(exampleRoot)) {
  // ponytail: ornek-veriler local-only; CI should not fail when the ignored folder is absent.
  console.log("UI/UX örnek fixture kaynak kontrolü atlandı: ornek-veriler dizini yok.");
} else if (lstatSync(exampleRoot).isSymbolicLink() || !lstatSync(exampleRoot).isDirectory()) {
  failures.push("ornek-veriler symlink olmayan dizin olmalı.");
}

if (hasExampleRoot) {
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
}

for (const template of importTemplates) {
  const templatePath = resolve(exampleRoot, template.file);
  const publicTemplatePath = resolve(publicTemplateRoot, template.file);
  requireRegularFile(publicTemplatePath, `${template.file} public kopyası`, 1000);
  requireXlsxZip(publicTemplatePath, `${template.file} public kopyası`);
  await requireWorkbookHeaders(publicTemplatePath, `${template.file} public kopyası`, template.sheet, template.headers, template);
  remember(publicTemplatePath);

  if (hasExampleRoot) {
    requireRegularFile(templatePath, template.file, 1000);
    requireXlsxZip(templatePath, template.file);
    await requireWorkbookHeaders(templatePath, `${template.file} kaynak`, template.sheet, template.headers, template);
    requireSameHash(templatePath, publicTemplatePath, template.file);
    remember(templatePath);
  }
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

async function requireWorkbookHeaders(filePath, label, sheetName, expectedHeaders, options = {}) {
  if (!existsSync(filePath)) return;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    failures.push(`${label} içinde ${sheetName} sayfası bulunamadı.`);
    return;
  }

  const headers = worksheet.getRow(1).values
    .slice(1, expectedHeaders.length + 1)
    .map((value) => String(value ?? "").trim());
  if (headers.join("|") !== expectedHeaders.join("|")) {
    failures.push(`${label} başlıkları beklenen alanlarla eşleşmiyor: ${headers.join(", ")}`);
  }
  requireNoDataRows(worksheet, label, expectedHeaders.length);
  if (options.validateNationalIds) {
    requireValidNationalIds(worksheet, label, expectedHeaders.indexOf("tc_kimlik_no") + 1);
  }
}

function requireNoDataRows(worksheet, label, expectedColumnCount) {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const hasData = Array.from({ length: expectedColumnCount }, (_item, index) =>
      String(row.getCell(index + 1).value ?? "").trim(),
    ).some(Boolean);
    if (hasData) {
      failures.push(`${label} örnek kişi verisi içermemeli: satır ${rowNumber}.`);
    }
  });
}

function requireValidNationalIds(worksheet, label, nationalIdColumn) {
  if (nationalIdColumn < 1) return;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nationalId = String(row.getCell(nationalIdColumn).value ?? "").trim();
    if (nationalId && !isValidTcIdentity(nationalId)) {
      failures.push(`${label} geçersiz TC kimlik no içeriyor: satır ${rowNumber}.`);
    }
  });
}

function isValidTcIdentity(value) {
  const normalized = value.replace(/\D/g, "");
  if (!/^[1-9]\d{10}$/.test(normalized)) return false;

  const digits = normalized.split("").map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  const total = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return digits[9] === tenth && digits[10] === total;
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

function requireSameHash(sourcePath, publicPath, label) {
  if (!existsSync(sourcePath) || !existsSync(publicPath)) return;
  const sourceDigest = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  const publicDigest = createHash("sha256").update(readFileSync(publicPath)).digest("hex");
  if (sourceDigest !== publicDigest) {
    failures.push(`${label} public kopyası kaynak dosyayla aynı değil.`);
  }
}
