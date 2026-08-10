import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { ReportModule } from "../report/report.module.js";
import { SchoolModule } from "../school/school.module.js";
import { AnswerKeyController } from "./answer-key.controller.js";
import { AnswerKeyExcelImportService } from "./answer-key-excel-import.service.js";
import { AnswerKeyService, answerKeyRepositoryToken } from "./answer-key.service.js";
import { ExamController } from "./exam.controller.js";
import { ExamPersistenceModule } from "./exam-persistence.module.js";
import { ExamService } from "./exam.service.js";
import { ImportQuarantineController } from "./import-quarantine.controller.js";
import { OpticalFormTemplateController } from "./optical-form-template.controller.js";
import { OpticalFormTemplateService } from "./optical-form-template.service.js";
import { createOpticalFormTemplateStore, opticalFormTemplateStoreToken } from "./optical-form-template-store.js";
import { ParserConfigController } from "./parser-config.controller.js";
import { ParserConfigApprovalService, parserConfigRepositoryToken } from "./parser-config-approval.service.js";
import { ParserConfigSuggestionService } from "./parser-config-suggestion.service.js";
import { PostgresAnswerKeyRepository } from "./postgres-answer-key-repository.js";
import { PostgresParserConfigRepository } from "./postgres-parser-config-repository.js";
import { PostgresRawImportRepository } from "./postgres-raw-import-repository.js";
import { RawImportController } from "./raw-import.controller.js";
import { RawImportAnalysisService } from "./raw-import-analysis.service.js";
import { createRawImportAnalysisStore, rawImportAnalysisStoreToken } from "./raw-import-analysis-store.js";
import { createRawImportQuarantineStore, rawImportQuarantineStoreToken } from "./raw-import-quarantine-store.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";
import { RawImportQueueService, rawImportQueueProducerToken } from "./raw-import-queue.service.js";
import {
  RawImportUploadService,
  rawImportArchiveStoreToken,
  rawImportRepositoryToken,
} from "./raw-import-upload.service.js";
import { createS3RawImportArchiveStoreFromEnv } from "./s3-raw-import-archive-store.js";

@Module({
  imports: [AuditLogModule, ExamPersistenceModule, ReportModule, SchoolModule],
  controllers: [
    AnswerKeyController,
    ExamController,
    ImportQuarantineController,
    OpticalFormTemplateController,
    ParserConfigController,
    RawImportController,
  ],
  providers: [
    AnswerKeyService,
    AnswerKeyExcelImportService,
    {
      provide: answerKeyRepositoryToken,
      useFactory: () => new PostgresAnswerKeyRepository(),
    },
    ExamService,
    OpticalFormTemplateService,
    ParserConfigApprovalService,
    ParserConfigSuggestionService,
    {
      provide: opticalFormTemplateStoreToken,
      useFactory: createOpticalFormTemplateStore,
    },
    {
      provide: parserConfigRepositoryToken,
      useFactory: () => new PostgresParserConfigRepository(),
    },
    RawImportQueueService,
    RawImportAnalysisService,
    RawImportQuarantineService,
    RawImportUploadService,
    {
      provide: rawImportArchiveStoreToken,
      useFactory: () => ({
        put(input: Parameters<ReturnType<typeof createS3RawImportArchiveStoreFromEnv>["put"]>[0]) {
          return createS3RawImportArchiveStoreFromEnv().put(input);
        },
        delete(s3Key: string) {
          return createS3RawImportArchiveStoreFromEnv().delete(s3Key);
        },
      }),
    },
    {
      provide: rawImportRepositoryToken,
      useFactory: () => new PostgresRawImportRepository(),
    },
    {
      provide: rawImportAnalysisStoreToken,
      useFactory: createRawImportAnalysisStore,
    },
    {
      provide: rawImportQuarantineStoreToken,
      useFactory: createRawImportQuarantineStore,
    },
    {
      provide: rawImportQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
  ],
})
export class ExamModule {}
