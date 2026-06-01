import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const script = readFileSync("scripts/k6-report-listing.js", "utf8");

const expectations = [
  ["package.json", packageJson.scripts?.["report-listing:k6"] === "k6 run scripts/k6-report-listing.js"],
  ["package.json", packageJson.scripts?.["report-listing:k6:check"] === "node scripts/check-k6-report-listing.mjs"],
  ["scripts/k6-report-listing.js", script.includes("EXPECTED_RESULT_COUNT || \"10000\"")],
  ["scripts/k6-report-listing.js", script.includes("EXPECTED_RESULT_COUNT must be at least 10000")],
  ["scripts/k6-report-listing.js", script.includes("/api/v1/exams/${encodeURIComponent(examId)}/reports/snapshots")],
  ["scripts/k6-report-listing.js", script.includes("/reports/students/${encodeURIComponent(resolvedStudentId)}/progress")],
  ["scripts/k6-report-listing.js", script.includes("\"http_req_duration{endpoint:snapshots}\": [\"p(95)<1500\"]")],
  ["scripts/k6-report-listing.js", script.includes("\"http_req_duration{endpoint:student_progress}\": [\"p(95)<1200\"]")],
  ["scripts/k6-report-listing.js", script.includes("snapshot list includes 10k students")],
];

const failures = expectations
  .map(([file, passed], index) => ({ file, index, passed }))
  .filter((expectation) => !expectation.passed);

if (failures.length > 0) {
  console.error("k6 rapor listeleme kontrolü başarısız:");
  for (const failure of failures) {
    console.error(`- ${failure.file} beklenti ${failure.index + 1} eksik`);
  }
  process.exit(1);
}

console.log("k6 rapor listeleme kontrolü geçti.");
