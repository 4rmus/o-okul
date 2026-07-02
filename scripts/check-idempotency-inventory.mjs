import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = {
  journeys: readFileSync("docs/product-journeys-v1.md", "utf8"),
  openApiArtifact: JSON.parse(readFileSync("artifacts/openapi.json", "utf8")),
  generateOpenApi: readFileSync("scripts/generate-openapi.mjs", "utf8"),
  openApiContracts: readFileSync("apps/api/src/openapi-contracts.ts", "utf8"),
};

const inventory = [
  entry("announcement.create", "POST", "/api/v1/announcements", "covered", "apps/api/src/announcement/announcement.controller.ts", "apps/api/src/announcement/announcement.service.ts", "apps/api/src/announcement/announcement.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["announcement-create-idempotency-a"]),
  entry("announcement.delivery-result.enqueue", "POST", "/api/v1/announcements/{id}/delivery-results", "covered", "apps/api/src/announcement/announcement.controller.ts", "apps/api/src/announcement/announcement.service.ts", "apps/api/src/announcement/announcement.e2e.test.ts", ["@Post(\":id/delivery-results\")", "@Headers(\"idempotency-key\")"], ["announcement-delivery-result-idempotency-a"]),
  entry("announcement.delivery.send", "POST", "/api/v1/announcements/{id}/deliveries", "covered", "apps/api/src/announcement/announcement.controller.ts", "apps/api/src/announcement/announcement.service.ts", "apps/api/src/announcement/announcement.e2e.test.ts", ["@Post(\":id/deliveries\")", "@Headers(\"idempotency-key\")"], ["announcement-delivery-send-idempotency-a"]),
  entry("answer-key.create", "POST", "/api/v1/exams/{examId}/answer-keys", "covered", "apps/api/src/exam/answer-key.controller.ts", "apps/api/src/exam/answer-key.service.ts", "apps/api/src/exam/answer-key.controller.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["answer-key-create-idempotency-a"]),
  entry("answer-key.import.commit", "POST", "/api/v1/exams/{examId}/answer-keys/imports", "covered", "apps/api/src/exam/answer-key.controller.ts", "apps/api/src/exam/answer-key-excel-import.service.ts", "apps/api/src/exam/answer-key.controller.e2e.test.ts", ["@Post(\"imports\")", "@Headers(\"idempotency-key\")"], ["answer-key-import-idempotency-a"]),
  entry("answer-key.publish", "POST", "/api/v1/exams/{examId}/answer-keys/{version}/publish", "covered", "apps/api/src/exam/answer-key.controller.ts", "apps/api/src/exam/answer-key.service.ts", "apps/api/src/exam/answer-key.controller.e2e.test.ts", ["@Post(\":version/publish\")", "@Headers(\"idempotency-key\")"], ["answer-key-publish-idempotency-a"]),
  entry("backup-restore.enqueue", "POST", "/api/v1/backup-restore-jobs", "covered", "apps/api/src/operations/backup-restore.controller.ts", "apps/api/src/operations/backup-restore.service.ts", "apps/api/src/operations/backup-restore.controller.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["backup-restore-idempotency-a"]),
  entry("class.create", "POST", "/api/v1/classes", "covered", "apps/api/src/school/classes.controller.ts", "apps/api/src/school/school.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["class-create-idempotency-a"]),
  entry("course.create", "POST", "/api/v1/courses", "covered", "apps/api/src/school/courses.controller.ts", "apps/api/src/school/school.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["course-create-idempotency-a"]),
  entry("exam.create", "POST", "/api/v1/exams", "covered", "apps/api/src/exam/exam.controller.ts", "apps/api/src/exam/exam.service.ts", "apps/api/src/exam/exam.controller.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["exam-create-idempotency-a"]),
  entry("exam.participant.create", "POST", "/api/v1/exams/{examId}/participants", "covered", "apps/api/src/exam/exam.controller.ts", "apps/api/src/exam/exam.service.ts", "apps/api/src/exam/exam.controller.e2e.test.ts", ["@Post(\":examId/participants\")", "@Headers(\"idempotency-key\")"], ["exam-participant-idempotency-a"]),
  entry("exam.publish", "POST", "/api/v1/exams/{examId}/publish", "covered", "apps/api/src/exam/exam.controller.ts", "apps/api/src/exam/exam.service.ts", "apps/api/src/exam/exam.controller.e2e.test.ts", ["@Post(\":examId/publish\")", "@Headers(\"idempotency-key\")"], ["exam-publish-idempotency-a"]),
  entry("homework.material-assignment.create", "POST", "/api/v1/homework/materials/{id}/assignments", "covered", "apps/api/src/homework/homework.controller.ts", "apps/api/src/homework/homework.service.ts", "apps/api/src/homework/homework.e2e.test.ts", ["@Post(\"materials/:id/assignments\")", "@Headers(\"idempotency-key\")"], ["homework-material-assignment-idempotency-a"]),
  entry("homework.material-file.create", "POST", "/api/v1/homework/materials/{id}/files", "covered", "apps/api/src/homework/homework.controller.ts", "apps/api/src/homework/homework.service.ts", "apps/api/src/homework/homework.e2e.test.ts", ["@Post(\"materials/:id/files\")", "@Headers(\"idempotency-key\")"], ["homework-material-file-idempotency-a"]),
  entry("optical-form-template.apply", "POST", "/api/v1/optical-form-templates/{templateId}/apply", "covered", "apps/api/src/exam/optical-form-template.controller.ts", "apps/api/src/exam/optical-form-template.service.ts", "apps/api/src/exam/optical-form-template.controller.e2e.test.ts", ["@Post(\":templateId/apply\")", "@Headers(\"idempotency-key\")"], ["optical-form-template-apply-idempotency-a"]),
  entry("optical-form-template.create", "POST", "/api/v1/optical-form-templates", "covered", "apps/api/src/exam/optical-form-template.controller.ts", "apps/api/src/exam/optical-form-template.service.ts", "apps/api/src/exam/optical-form-template.controller.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["optical-form-template-create-idempotency-a"]),
  entry("parser-config.approve", "POST", "/api/v1/exams/{examId}/parser-configs/approvals", "covered", "apps/api/src/exam/parser-config.controller.ts", "apps/api/src/exam/parser-config-approval.service.ts", "apps/api/src/exam/parser-config.controller.e2e.test.ts", ["@Post(\"approvals\")", "@Headers(\"idempotency-key\")"], ["parser-config-approval-idempotency-a"]),
  entry("payment.installment.update", "PATCH", "/api/v1/payment-plans/{planId}/installments/{installmentId}", "covered", "apps/api/src/payment/payment.controller.ts", "apps/api/src/payment/payment.service.ts", "apps/api/src/payment/payment.e2e.test.ts", ["@Patch(\":planId/installments/:installmentId\")", "@Headers(\"idempotency-key\")"], ["payment-installment-idempotent-update"]),
  entry("payment.plan.cancel", "DELETE", "/api/v1/payment-plans/{planId}", "covered", "apps/api/src/payment/payment.controller.ts", "apps/api/src/payment/payment.service.ts", "apps/api/src/payment/payment.e2e.test.ts", ["@Delete(\":planId\")", "@Headers(\"idempotency-key\")"], ["payment-plan-cancel-idempotency-a"]),
  entry("payment.plan.create", "POST", "/api/v1/payment-plans", "covered", "apps/api/src/payment/payment.controller.ts", "apps/api/src/payment/payment.service.ts", "apps/api/src/payment/payment.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["payment-plan-idempotent-create"]),
  entry("payment.transaction.create", "POST", "/api/v1/payment-plans/{planId}/transactions", "covered", "apps/api/src/payment/payment.controller.ts", "apps/api/src/payment/payment.service.ts", "apps/api/src/payment/payment.e2e.test.ts", ["@Post(\":planId/transactions\")", "@Headers(\"idempotency-key\")"], ["payment-transaction-create-idempotency-a"]),
  entry("payment.transaction.void", "POST", "/api/v1/payment-plans/{planId}/transactions/{transactionId}/void", "covered", "apps/api/src/payment/payment.controller.ts", "apps/api/src/payment/payment.service.ts", "apps/api/src/payment/payment.e2e.test.ts", ["@Post(\":planId/transactions/:transactionId/void\")", "@Headers(\"idempotency-key\")"], ["payment-transaction-void-idempotency-a"]),
  entry("raw-import.evaluation.enqueue", "POST", "/api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-jobs", "covered", "apps/api/src/exam/raw-import.controller.ts", "apps/api/src/exam/raw-import-analysis.service.ts", "apps/api/src/exam/raw-import.controller.e2e.test.ts", ["@Post(\":rawImportId/evaluation-jobs\")", "@Headers(\"idempotency-key\")"], ["raw-import-evaluation-idempotency-a"]),
  entry("raw-import.quarantine.resolve-bulk", "POST", "/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/resolve-bulk", "covered", "apps/api/src/exam/raw-import.controller.ts", "apps/api/src/exam/raw-import-quarantine.service.ts", "apps/api/src/exam/raw-import.controller.e2e.test.ts", ["@Post(\":rawImportId/quarantines/resolve-bulk\")", "@Headers(\"idempotency-key\")"], ["raw-import-quarantine-resolve-bulk-idempotency-a"]),
  entry("raw-import.quarantine.resolve", "POST", "/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/{quarantineId}/resolve", "covered", "apps/api/src/exam/raw-import.controller.ts", "apps/api/src/exam/raw-import-quarantine.service.ts", "apps/api/src/exam/raw-import.controller.e2e.test.ts", ["@Post(\":rawImportId/quarantines/:quarantineId/resolve\")", "@Headers(\"idempotency-key\")"], ["raw-import-quarantine-resolve-idempotency-a"]),
  entry("raw-import.upload", "POST", "/api/v1/exams/{examId}/raw-imports", "covered", "apps/api/src/exam/raw-import.controller.ts", "apps/api/src/exam/raw-import-upload.service.ts", "apps/api/src/exam/raw-import.controller.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["raw-import-upload-idempotency-a"]),
  entry("report.generation.enqueue", "POST", "/api/v1/exams/{examId}/reports/generation-jobs", "covered", "apps/api/src/report/report-generation.controller.ts", "apps/api/src/report/report-generation.service.ts", "apps/api/src/report/report-generation.controller.e2e.test.ts", ["@Post(\"generation-jobs\")", "@Headers(\"idempotency-key\")"], ["report-generation-idempotency-a"]),
  entry("schedule-lesson.create", "POST", "/api/v1/schedule-lessons", "covered", "apps/api/src/program/schedule.controller.ts", "apps/api/src/program/schedule.service.ts", "apps/api/src/program/schedule.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["schedule-lesson-create-idempotency-a"]),
  entry("sms.batch.enqueue", "POST", "/api/v1/sms-batches", "covered", "apps/api/src/sms-batch/sms-batch.controller.ts", "apps/api/src/sms-batch/sms-batch.service.ts", "apps/api/src/sms-batch/sms-batch.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["sms-batch-idempotency-a"]),
  entry("student.create", "POST", "/api/v1/students", "covered", "apps/api/src/student/student.controller.ts", "apps/api/src/student/student.service.ts", "apps/api/src/app.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["student-create-idempotency-a"]),
  entry("student.enrollment.bulk-renew", "POST", "/api/v1/students/enrollments/bulk-renew", "covered", "apps/api/src/student/student.controller.ts", "apps/api/src/student/student.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\"enrollments/bulk-renew\")", "@Headers(\"idempotency-key\")"], ["student-bulk-renew-"]),
  entry("student.enrollment.renew", "POST", "/api/v1/students/{id}/enrollments/renew", "covered", "apps/api/src/student/student.controller.ts", "apps/api/src/student/student.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\":id/enrollments/renew\")", "@Headers(\"idempotency-key\")"], ["student-renew-"]),
  entry("student.enrollment.transfer", "POST", "/api/v1/students/{id}/enrollments/transfer", "covered", "apps/api/src/student/student.controller.ts", "apps/api/src/student/student.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\":id/enrollments/transfer\")", "@Headers(\"idempotency-key\")"], ["student-transfer-"]),
  entry("student.import.commit", "POST", "/api/v1/students/imports", "covered", "apps/api/src/student/student.controller.ts", "apps/api/src/student/student-import.service.ts", "apps/api/src/app.e2e.test.ts", ["@Post(\"imports\")", "@Headers(\"idempotency-key\")"], ["student-import-idempotency-a"]),
  entry("study-session.create", "POST", "/api/v1/study-sessions", "covered", "apps/api/src/program/study-session.controller.ts", "apps/api/src/program/study-session.service.ts", "apps/api/src/program/study-session.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["study-session-create-idempotency-a"]),
  entry("support-ticket.attachment.create", "POST", "/api/v1/support-tickets/{id}/attachments", "covered", "apps/api/src/support-ticket/support-ticket.controller.ts", "apps/api/src/support-ticket/support-ticket.service.ts", "apps/api/src/support-ticket/support-ticket.e2e.test.ts", ["@Post(\":id/attachments\")", "@Headers(\"idempotency-key\")"], ["support-attachment-idempotency-a"]),
  entry("support-ticket.comment.create", "POST", "/api/v1/support-tickets/{id}/comments", "covered", "apps/api/src/support-ticket/support-ticket.controller.ts", "apps/api/src/support-ticket/support-ticket.service.ts", "apps/api/src/support-ticket/support-ticket.e2e.test.ts", ["@Post(\":id/comments\")", "@Headers(\"idempotency-key\")"], ["support-comment-idempotency-a"]),
  entry("guardian.create", "POST", "/api/v1/guardians", "covered", "apps/api/src/guardian/guardians.controller.ts", "apps/api/src/guardian/guardian.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["guardian-create-idempotency-a"]),
  entry("guardian.import.commit", "POST", "/api/v1/guardians/imports", "covered", "apps/api/src/guardian/guardians.controller.ts", "apps/api/src/guardian/guardian-import.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\"imports\")", "@Headers(\"idempotency-key\")"], ["guardian-import-idempotency-a"]),
  entry("guardian.student-link.create", "POST", "/api/v1/guardians/{id}/students", "covered", "apps/api/src/guardian/guardians.controller.ts", "apps/api/src/guardian/guardian.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\":id/students\")", "@Headers(\"idempotency-key\")"], ["guardian-student-link-create-idempotency-a"]),
  entry("teacher.assignment.create", "POST", "/api/v1/teachers/{id}/assignments", "covered", "apps/api/src/teacher/teachers.controller.ts", "apps/api/src/teacher/teacher.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\":id/assignments\")", "@Headers(\"idempotency-key\")"], ["teacher-assignment-create-idempotency-a"]),
  entry("teacher.create", "POST", "/api/v1/teachers", "covered", "apps/api/src/teacher/teachers.controller.ts", "apps/api/src/teacher/teacher.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post()", "@Headers(\"idempotency-key\")"], ["teacher-create-idempotency-a"]),
  entry("teacher.import.commit", "POST", "/api/v1/teachers/imports", "covered", "apps/api/src/teacher/teachers.controller.ts", "apps/api/src/teacher/teacher-import.service.ts", "apps/api/src/school/school.e2e.test.ts", ["@Post(\"imports\")", "@Headers(\"idempotency-key\")"], ["teacher-import-idempotency-a"]),
];

const failures = [];
const operationsInCode = extractOperations("apps/api/src");
const inventoryOperations = new Set(inventory.map((item) => item.operation));
const operationsWithoutRequestBody = new Set([
  "answer-key.publish",
  "exam.publish",
  "payment.plan.cancel",
]);

for (const operation of operationsInCode) {
  if (!inventoryOperations.has(operation)) {
    failures.push(`Idempotency operation envanterde yok: ${operation}`);
  }
}

for (const item of inventory) {
  if (!operationsInCode.has(item.operation)) {
    failures.push(`Idempotency operation kodda bulunamadi: ${item.operation}`);
  }
  checkFileTokens(item.controllerFile, item.controllerTokens, `${item.operation} controller`, failures);
  checkFileTokens(item.serviceFile, [`operation: "${item.operation}"`], `${item.operation} service`, failures);
  checkFileTokens(item.testFile, ["Idempotency-Key", ...item.testTokens], `${item.operation} e2e`, failures);

  if (item.openApi !== "covered") {
    failures.push(`${item.operation} openapi status covered olmali.`);
  }
  if (!hasOpenApiHeaderContract(item)) {
    failures.push(`${item.operation} OpenAPI optional Idempotency-Key header contract eksik: ${item.method} ${item.path}`);
  }
  if (!hasOpenApiResponseEnvelope(item)) {
    failures.push(`${item.operation} OpenAPI response { data } envelope eksik: ${item.method} ${item.path}`);
  }
  if (!operationsWithoutRequestBody.has(item.operation) && !hasOpenApiRequestBody(item)) {
    failures.push(`${item.operation} OpenAPI request body schema eksik: ${item.method} ${item.path}`);
  }
}

const uatKurums07 = findTableRow(files.journeys, "UAT-KURUM-07");
for (const token of [
  "idempotent calisir",
  "ogretmen import commit",
  "scripts/check-idempotency-inventory.mjs",
  "pnpm idempotency:inventory:check",
]) {
  if (!uatKurums07.includes(token)) {
    failures.push(`UAT-KURUM-07 satiri idempotency envanteri token eksik: ${token}`);
  }
}

if (failures.length > 0) {
  console.error("Idempotency envanter kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Idempotency envanter kontrolu gecti: ${inventory.length} operation, tamaminda OpenAPI Idempotency-Key header ve response envelope covered.`);

function entry(operation, method, path, openApi, controllerFile, serviceFile, testFile, controllerTokens, testTokens) {
  return { operation, method, path, openApi, controllerFile, serviceFile, testFile, controllerTokens, testTokens };
}

function extractOperations(root) {
  const source = readFileSyncRecursiveManifest(root);
  return new Set([...source.matchAll(/operation:\s*"([^"]+)"/g)].map((match) => match[1]));
}

function readFileSyncRecursiveManifest(root) {
  const entries = readdirSync(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => readFileSync(join(entry.parentPath ?? entry.path, entry.name), "utf8"))
    .join("\n");
}

function checkFileTokens(path, tokens, label, output) {
  const source = readFileSync(path, "utf8");
  for (const token of tokens) {
    if (!source.includes(token)) {
      output.push(`${label} token eksik (${path}): ${token}`);
    }
  }
}

function hasOpenApiHeaderContract(item) {
  return hasArtifactOpenApiHeader(item) || hasGenerateOpenApiHeaderContract(item) || hasOverlayOpenApiHeaderContract(item);
}

function hasArtifactOpenApiHeader(item) {
  const operation = openApiOperation(item);
  const header = (operation?.parameters ?? []).find((parameter) =>
    parameter?.in === "header" &&
    typeof parameter.name === "string" &&
    parameter.name.toLowerCase() === "idempotency-key",
  );
  return Boolean(
    header &&
    header.required === false &&
    header.schema?.maxLength === 128 &&
    String(header.description ?? "").includes("409"),
  );
}

function hasOpenApiRequestBody(item) {
  return Boolean(openApiOperation(item)?.requestBody?.content?.["application/json"]?.schema);
}

function hasOpenApiResponseEnvelope(item) {
  const operation = openApiOperation(item);
  const successResponse = operation?.responses?.["201"] ?? operation?.responses?.["200"];
  return Boolean(successResponse?.content?.["application/json"]?.schema?.properties?.data);
}

function openApiOperation(item) {
  return files.openApiArtifact.paths?.[item.path]?.[item.method.toLowerCase()];
}

function hasGenerateOpenApiHeaderContract(item) {
  for (const index of allIndexes(files.generateOpenApi, `path: "${item.path}"`)) {
    const block = files.generateOpenApi.slice(Math.max(0, index - 160), index + 520);
    if (block.includes(`method: "${item.method.toLowerCase()}"`) && block.includes("idempotencyHeader: true")) {
      return true;
    }
  }
  return false;
}

function hasOverlayOpenApiHeaderContract(item) {
  const key = `"${item.method.toLowerCase()} ${item.path}"`;
  const index = files.openApiContracts.indexOf(key);
  if (index === -1) return false;
  return files.openApiContracts.slice(index, index + 320).includes("idempotent: true");
}

function allIndexes(source, token) {
  const indexes = [];
  let index = source.indexOf(token);
  while (index !== -1) {
    indexes.push(index);
    index = source.indexOf(token, index + token.length);
  }
  return indexes;
}

function findTableRow(markdown, token) {
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| ${token} |`)) ??
    markdown.split(/\r?\n/).find((line) => line.startsWith("|") && line.includes(token)) ??
    "";
}
