import { DataTable, type DataTableColumn } from "@o-okul/ui";
import type { ReportStudentQuestionSummary } from "@o-okul/shared-types";
import { formatCourseName, formatOutcomeCode } from "./academic-labels.js";

const columns: Array<DataTableColumn<ReportStudentQuestionSummary>> = [
  { key: "question", header: "Soru", mobilePriority: "primary", priority: "primary", render: (item) => item.questionNo },
  { key: "course", header: "Ders", mobilePriority: "primary", priority: "primary", render: (item) => formatCourseName(item.branch) },
  { key: "outcome", header: "Kazanım", mobilePriority: "secondary", priority: "secondary", render: (item) => (item.outcomeCode ? formatOutcomeCode(item.outcomeCode) : "-") },
  { key: "status", header: "Durum", mobilePriority: "primary", priority: "primary", render: (item) => formatQuestionStatus(item.status) },
  { key: "answer", header: "Yanıt", mobilePriority: "secondary", priority: "secondary", render: (item) => (item.status === "BLANK" ? "Boş" : item.answer) },
  { key: "correct", header: "Doğru", mobilePriority: "secondary", priority: "secondary", render: (item) => item.correctAnswer },
];

// İptal soruları hata kitapçığında gösterilmez; rapor ve öğrenci detayı aynı tabloyu kullanır.
export function ErrorBookletTable({ caption, emptyLabel, items }: { caption: string; emptyLabel: string; items: ReportStudentQuestionSummary[] }) {
  return (
    <DataTable
      caption={caption}
      className="next-error-booklet-table"
      columns={columns}
      density="compact"
      emptyText={emptyLabel}
      getRowKey={(item) => `${item.questionNo}-${item.branch}-${item.status}`}
      rows={items.filter((item) => item.status !== "CANCELLED")}
    />
  );
}

function formatQuestionStatus(status: ReportStudentQuestionSummary["status"]) {
  const labels: Record<ReportStudentQuestionSummary["status"], string> = {
    BLANK: "Boş",
    CANCELLED: "İptal",
    CORRECT: "Doğru",
    WRONG: "Yanlış",
  };
  return labels[status] ?? "Durum bilgisi alınamadı";
}
