import { OpticalAnswerParser, type OpticalAnswerParseResult } from "./optical-answer-parser.js";
import {
  type LoadOpticalParseInput,
  type OpticalParseInputBundle,
} from "./postgres-optical-parse-input-adapter.js";
import {
  type SavedOpticalParseResult,
  type SaveOpticalParseResultInput,
} from "./postgres-optical-parse-adapter.js";

export interface OpticalParseInputLoader {
  load(input: LoadOpticalParseInput): Promise<OpticalParseInputBundle>;
}

export interface RawImportContentReader {
  read(input: { s3Key: string; fileName: string }): Promise<string | Buffer>;
}

export interface OpticalParseResultSaver {
  save(input: SaveOpticalParseResultInput): Promise<SavedOpticalParseResult>;
}

export interface OpticalParseWorkflowResult {
  tenantId: string;
  rawImportId: string;
  s3Key: string;
  matchedRows: number;
  unmatchedRows: number;
  matchedSaved: number;
  unmatchedSaved: number;
}

export class OpticalParseWorkflow {
  constructor(
    private readonly inputLoader: OpticalParseInputLoader,
    private readonly contentReader: RawImportContentReader,
    private readonly resultSaver: OpticalParseResultSaver,
    private readonly parser = new OpticalAnswerParser(),
  ) {}

  async process(input: LoadOpticalParseInput): Promise<OpticalParseWorkflowResult> {
    const bundle = await this.inputLoader.load(input);
    const content = await this.contentReader.read({
      s3Key: bundle.s3Key,
      fileName: bundle.fileName,
    });
    const parseResult = this.parser.parse({
      tenantId: bundle.tenantId,
      examId: bundle.examId,
      rawImportId: bundle.rawImportId,
      parserConfigVersion: bundle.parserConfigVersion,
      content,
      parserConfig: bundle.parserConfig,
      participants: bundle.participants,
    });
    const saved = await this.resultSaver.save({
      tenantId: bundle.tenantId,
      result: parseResult,
    });

    return toWorkflowResult(bundle, parseResult, saved);
  }
}

function toWorkflowResult(
  bundle: OpticalParseInputBundle,
  parseResult: OpticalAnswerParseResult,
  saved: SavedOpticalParseResult,
): OpticalParseWorkflowResult {
  return {
    tenantId: bundle.tenantId,
    rawImportId: bundle.rawImportId,
    s3Key: bundle.s3Key,
    matchedRows: parseResult.matched.length,
    unmatchedRows: parseResult.unmatched.length,
    matchedSaved: saved.matchedSaved,
    unmatchedSaved: saved.unmatchedSaved,
  };
}
