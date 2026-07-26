import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FormatAnalyzerService,
  getParserConfigPresetSuggestion,
  type ParserConfigSuggestionRequest,
  type ParserConfigSuggestionResult as SharedParserConfigSuggestionResult,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { type ExamRepository, examRepositoryToken } from "./exam.service.js";

export interface ParserConfigSuggestionInput extends ParserConfigSuggestionRequest {
  examId?: string;
}

export type ParserConfigSuggestionResult = SharedParserConfigSuggestionResult;

@Injectable()
export class ParserConfigSuggestionService {
  private readonly analyzer = new FormatAnalyzerService();

  constructor(
    @Inject(examRepositoryToken)
    private readonly exams: Pick<ExamRepository, "findById">,
  ) {}

  async suggest(
    context: RequestContext,
    input: ParserConfigSuggestionInput,
  ): Promise<ParserConfigSuggestionResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const examId = required(input.examId, "PARSER_CONFIG_EXAM_REQUIRED");
    if (input.preset) {
      try {
        let examType: string | undefined;
        if (input.preset === "OPTIK_129" || input.preset === "YANIT") {
          const exam = await this.exams.findById(context.tenantId, examId);
          if (!exam) {
            throw new NotFoundException("PARSER_CONFIG_EXAM_NOT_FOUND");
          }
          examType = exam.examType;
        }
        return {
          examId,
          suggestion: getParserConfigPresetSuggestion(input.preset, examType),
          status: "suggested",
        };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("FORMAT_ANALYZER_")) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    const content = readContent(input);

    try {
      return {
        examId,
        suggestion: this.analyzer.analyze({
          content,
          sampleSize: normalizeSampleSize(input.sampleSize),
        }),
        status: "suggested",
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("FORMAT_ANALYZER_")) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function readContent(input: ParserConfigSuggestionInput): string | Uint8Array {
  const sampleText = input.sampleText?.trim();
  if (sampleText) {
    return sampleText;
  }

  const fileBase64 = input.fileBase64?.trim();
  if (!fileBase64) {
    throw new BadRequestException("PARSER_CONFIG_SAMPLE_REQUIRED");
  }
  const bytes = Buffer.from(fileBase64, "base64");
  if (bytes.length === 0) {
    throw new BadRequestException("PARSER_CONFIG_SAMPLE_REQUIRED");
  }
  return bytes;
}

function normalizeSampleSize(sampleSize: number | undefined): number | undefined {
  if (sampleSize === undefined) {
    return undefined;
  }
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    throw new BadRequestException("PARSER_CONFIG_SAMPLE_SIZE_INVALID");
  }
  return sampleSize;
}
