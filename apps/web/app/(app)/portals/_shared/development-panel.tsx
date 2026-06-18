"use client";

import { DataTable, Panel, type DataTableColumn } from "@uzman-hocam/ui";
import type { DevelopmentTrendItem } from "@uzman-hocam/shared-types";

export type { DevelopmentTrendItem } from "@uzman-hocam/shared-types";

export function DevelopmentTrendPanel({ assessments }: { assessments: DevelopmentTrendItem[] }) {
  const scoreColumns: Array<DataTableColumn<DevelopmentTrendItem["scores"][number]>> = [
    {
      header: "Kriter",
      key: "criterion",
      priority: "primary",
      render: (score) => score.criterionName,
      sticky: "left",
    },
    {
      align: "right",
      header: "Puan",
      key: "score",
      priority: "primary",
      render: (score) => score.score,
    },
    {
      header: "Ölçek",
      key: "scale",
      priority: "secondary",
      render: (score) => `${score.scaleMin}-${score.scaleMax}`,
    },
  ];

  return (
    <Panel
      aria-label="Gelişim trendi"
      description="Mentorluk değerlendirmeleri, dönem notları ve kriter puanları."
      title="Gelişim ve Mentorluk"
    >
      {assessments.length === 0 ? (
        <p className="next-status-note">Henüz görünür gelişim değerlendirmesi yok.</p>
      ) : (
        <div className="next-note-list">
          {assessments.map((assessment) => (
            <article key={assessment.id}>
              <strong>{assessment.periodLabel}</strong>
              <span className="next-field-hint">{assessment.createdAt ? formatDate(assessment.createdAt) : "Tarih yok"}</span>
              {assessment.mentorNote ? <p>{assessment.mentorNote}</p> : null}
              <DataTable
                caption={`${assessment.periodLabel} gelişim puanları`}
                columns={scoreColumns}
                description="Mentorluk değerlendirmesindeki kriter puanları ve kullanılan ölçek."
                density="compact"
                emptyText="Gelişim kriteri yok."
                getRowKey={(score) => `${assessment.id}-${score.criterionId}`}
                rows={assessment.scores}
              />
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}
