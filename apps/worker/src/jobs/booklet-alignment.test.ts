import { describe, expect, it } from "vitest";
import { alignAnswersToMaster } from "./booklet-alignment.js";

describe("alignAnswersToMaster", () => {
  it("A kitapçığında cevapları değiştirmez", () => {
    const answers = [
      { questionNo: 1, answer: "A" as const },
      { questionNo: 2, answer: "B" as const },
    ];

    expect(alignAnswersToMaster(answers, "A", [{ code: "B", permutation: [2, 1] }])).toBe(answers);
  });

  it("B kitapçığı cevaplarını master soru sırasına taşır", () => {
    const aligned = alignAnswersToMaster(
      [
        { questionNo: 1, answer: "B" },
        { questionNo: 2, answer: "A" },
        { questionNo: 3, answer: "C" },
      ],
      "B",
      [{ code: "B", permutation: [2, 1, 3] }],
    );

    expect(aligned).toEqual([
      { questionNo: 1, answer: "A" },
      { questionNo: 2, answer: "B" },
      { questionNo: 3, answer: "C" },
    ]);
  });

  it("eşleşen kitapçık yoksa net hata verir", () => {
    expect(() => alignAnswersToMaster([{ questionNo: 1, answer: "A" }], "B", [])).toThrow(
      "EXAM_BOOKLET_VARIANT_NOT_FOUND",
    );
  });

  it("tekrarlı permütasyonu reddeder", () => {
    expect(() =>
      alignAnswersToMaster([{ questionNo: 1, answer: "A" }], "B", [{ code: "B", permutation: [1, 1] }]),
    ).toThrow("EXAM_BOOKLET_VARIANT_INVALID");
  });

  it("cevap sayısıyla uyuşmayan permütasyonu reddeder", () => {
    expect(() =>
      alignAnswersToMaster([{ questionNo: 1, answer: "A" }], "B", [{ code: "B", permutation: [1, 2] }]),
    ).toThrow("EXAM_BOOKLET_VARIANT_INVALID");
  });

  it("soru sayısını aşan permütasyon değerini reddeder", () => {
    expect(() =>
      alignAnswersToMaster(
        [{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "B" }],
        "B",
        [{ code: "B", permutation: [1, 3] }],
      ),
    ).toThrow("EXAM_BOOKLET_VARIANT_INVALID");
  });
});
