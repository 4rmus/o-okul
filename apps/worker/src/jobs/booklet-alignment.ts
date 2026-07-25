import type { StudentAnswer } from "./scoring-engine.js";

export interface ExamBookletVariantInput {
  code: string;
  permutation: number[];
}

export function alignAnswersToMaster(
  answers: StudentAnswer[],
  bookletType: string | null | undefined,
  variants: ExamBookletVariantInput[] = [],
): StudentAnswer[] {
  const code = bookletType?.trim();
  if (!code || code.toUpperCase() === "A") {
    return answers;
  }

  const variant = variants.find((item) => item.code.trim().toUpperCase() === code.toUpperCase());
  if (!variant) {
    throw new Error("EXAM_BOOKLET_VARIANT_NOT_FOUND");
  }

  validatePermutation(variant.permutation, answers.length);
  const answerByQuestionNo = new Map(answers.map((answer) => [answer.questionNo, answer.answer]));
  return variant.permutation.map((bookletQuestionNo, index) => ({
    questionNo: index + 1,
    answer: answerByQuestionNo.get(bookletQuestionNo) ?? "",
  }));
}

function validatePermutation(permutation: number[], expectedLength: number): void {
  if (permutation.length === 0 || permutation.length !== expectedLength) {
    throw new Error("EXAM_BOOKLET_VARIANT_INVALID");
  }

  const seen = new Set<number>();
  for (const questionNo of permutation) {
    if (!Number.isInteger(questionNo) || questionNo <= 0 || questionNo > expectedLength || seen.has(questionNo)) {
      throw new Error("EXAM_BOOKLET_VARIANT_INVALID");
    }
    seen.add(questionNo);
  }
}
