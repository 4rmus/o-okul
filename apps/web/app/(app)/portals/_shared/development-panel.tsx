"use client";

import { DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type { DevelopmentTrendItem } from "@o-okul/shared-types";

export type { DevelopmentTrendItem } from "@o-okul/shared-types";

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
      className="next-portal-development-panel"
      description="Mentorluk değerlendirmeleri, dönem notları ve kriter puanları."
      title="Gelişim ve Mentorluk"
    >
      {assessments.length === 0 ? (
        <p className="next-status-note">Henüz görünür gelişim değerlendirmesi yok.</p>
      ) : (
        <div className="next-note-list">
          {assessments.map((assessment) => (
            <article className="next-development-assessment" key={assessment.id}>
              <header className="next-development-assessment__header">
                <strong>{assessment.periodLabel}</strong>
                <span className="next-field-hint">{assessment.createdAt ? formatDate(assessment.createdAt) : "Tarih yok"}</span>
              </header>
              {assessment.mentorNote ? <p>{assessment.mentorNote}</p> : null}
              <DataTable
                caption={`${assessment.periodLabel} gelişim puanları`}
                className="next-development-score-table"
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
