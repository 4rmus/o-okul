#!/usr/bin/env node
// KF-10: anonymize a school's sample optical/list file before it reaches a demo tenant (KVKK).
// Works on bytes so fixed-width columns keep their offsets in any single-byte encoding (Windows-1254, ASCII):
//  - every digit run of 10+ (T.C. kimlik, phone) becomes a same-length fake that starts with 9 and is unique per row;
//  - e-mail addresses become same-length "x" runs;
//  - --mask columns (1-based, inclusive, e.g. 13-37 for the name field) are overwritten with "X", spaces kept;
//  - --keep columns are left out of the digit rule (forms that encode answers as digits).
// No network access; the input is never modified; the output is a new file next to it (or --output).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("anonymize-sample-file self-test geçti.");
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) usage("Girdi dosyası gerekli.");
if (!existsSync(args.input)) usage(`Girdi dosyası yok: ${args.input}`);
const output = args.output ?? defaultOutput(args.input);
if (output === args.input) usage("Çıktı girdinin üzerine yazılamaz.");
if (existsSync(output)) usage(`Çıktı zaten var, üzerine yazılmaz: ${output}`);

const { bytes, stats } = anonymize(readFileSync(args.input), parseRanges(args.mask), parseRanges(args.keep));
writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
console.log(`Anonim dosya yazıldı: ${output} (${stats.lines} satır, ${stats.numbers} uzun sayı, ${stats.emails} e-posta, ${stats.maskedCells} maskeli sütun karakteri).`);

export function anonymize(input, ranges = [], keep = []) {
  const stats = { lines: 0, numbers: 0, emails: 0, maskedCells: 0 };
  // latin1 maps bytes 1:1 to code units, so string offsets equal byte offsets and widths never change.
  const lines = input.toString("latin1").split(/(\r?\n)/);
  for (let index = 0; index < lines.length; index += 2) {
    let line = lines[index];
    if (!line) continue;
    stats.lines += 1;
    const row = stats.lines;
    for (const [start, end] of ranges) {
      const from = Math.min(start - 1, line.length);
      const to = Math.min(end, line.length);
      const masked = line.slice(from, to).replace(/[^ ]/g, () => {
        stats.maskedCells += 1;
        return "X";
      });
      line = line.slice(0, from) + masked + line.slice(to);
    }
    line = line.replace(/[A-Za-z0-9._%+\-\xc0-\xff]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, (email) => {
      stats.emails += 1;
      return "x".repeat(email.length);
    });
    line = line.replace(/\d{10,}/g, (digits, offset) => {
      if (keep.some(([start, end]) => offset >= start - 1 && offset + digits.length <= end)) return digits;
      stats.numbers += 1;
      return `9${String(row).padStart(digits.length - 1, "0")}`.slice(-digits.length).replace(/^./, "9");
    });
    lines[index] = line;
  }
  return { bytes: Buffer.from(lines.join(""), "latin1"), stats };
}

function parseRanges(value) {
  if (!value) return [];
  return value.split(",").map((part) => {
    const match = /^(\d+)-(\d+)$/.exec(part.trim());
    if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) usage(`Geçersiz --mask aralığı: ${part}`);
    return [Number(match[1]), Number(match[2])];
  });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mask") result.mask = argv[++index];
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--keep") result.keep = argv[++index];
    else if (!arg.startsWith("--") && !result.input) result.input = arg;
    else usage(`Bilinmeyen argüman: ${arg}`);
  }
  return result;
}

function defaultOutput(input) {
  const extension = extname(input);
  return `${input.slice(0, input.length - extension.length)}.anon${extension}`;
}

function usage(message) {
  console.error(`${message}\nKullanım: node scripts/anonymize-sample-file.mjs <dosya> [--mask 13-37,60-70] [--keep 80-179] [--output <dosya>]\n          node scripts/anonymize-sample-file.mjs --self-test`);
  process.exit(1);
}

function selfTest() {
  // Fixed-width optical row: student no (1-6), name (7-26, Windows-1254 "ŞÜ"), T.C. (27-37), answers (38-47).
  const name = Buffer.from([0xde, 0xdc, ...Buffer.from("KRÜ YILMAZ".replace("Ü", "U"))]);
  const row = (no, tc) => Buffer.concat([Buffer.from(no.padEnd(6)), Buffer.concat([name, Buffer.alloc(20 - name.length, 0x20)]), Buffer.from(tc), Buffer.from("ABCDEABCDE")]);
  const input = Buffer.concat([
    row("000123", "10000000146"), Buffer.from("\r\n"),
    row("000124", "10000001372"), Buffer.from("\r\n"),
    // Free-text line kept past the masked columns so the e-mail and phone rules are exercised on their own.
    Buffer.from(`${" ".repeat(30)}veli: ayse.yilmaz@okul.example.com tel 05551234567 / +905001112233\n`),
  ]);
  const original = Buffer.from(input);
  const { bytes, stats } = anonymize(input, [[7, 26]]);
  const text = bytes.toString("latin1");
  const outLines = text.split(/\r?\n/);
  const inLines = original.toString("latin1").split(/\r?\n/);

  assert.ok(input.equals(original), "girdi yerinde değiştirilmemeli");
  assert.deepEqual(outLines.map((line) => line.length), inLines.map((line) => line.length), "satır genişlikleri korunmalı");
  assert.equal(outLines[0].slice(0, 6), "000123", "öğrenci numarası korunmalı");
  assert.equal(outLines[0].slice(37, 47), "ABCDEABCDE", "cevaplar korunmalı");
  assert.match(outLines[0].slice(6, 26), /^X+ X+ *$/, "ad alanı X ile ezilmeli, boşluklar kalmalı");
  assert.doesNotMatch(text, /10000000146|10000001372/, "T.C. kimlik kalmamalı");
  assert.doesNotMatch(text, /5551234567|5001112233/, "telefon kalmamalı");
  assert.doesNotMatch(text, /@/, "e-posta kalmamalı");
  assert.doesNotMatch(text, /(?<!\d)(?!9)\d{11}(?!\d)/, "9 ile başlamayan 11 haneli sayı kalmamalı");
  assert.notEqual(outLines[0].slice(26, 37), outLines[1].slice(26, 37), "sahte kimlikler satıra özgü olmalı");
  assert.equal(stats.numbers, 4);
  const digitAnswers = Buffer.from("000125 12345123451234512345\n");
  assert.equal(anonymize(digitAnswers, [], [[8, 27]]).bytes.toString("latin1"), digitAnswers.toString("latin1"), "--keep rakam cevapları korumalı");
  assert.equal(stats.emails, 1);
  for (const forbidden of ["node:http", "node:https", "node:net", "fetch("]) {
    assert.ok(!readFileSync(new URL(import.meta.url)).toString().replace(/for \(const forbidden.*\n/, "").includes(forbidden), `ağ erişimi olmamalı: ${forbidden}`);
  }
}
