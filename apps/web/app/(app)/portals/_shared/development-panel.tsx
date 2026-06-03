"use client";

import type { DevelopmentTrendItem } from "@uzman-hocam/shared-types";

export type { DevelopmentTrendItem } from "@uzman-hocam/shared-types";

export function DevelopmentTrendPanel({ assessments }: { assessments: DevelopmentTrendItem[] }) {
  return (
    <section className="next-list-panel" aria-label="Gelişim trendi">
      <h2>Gelişim ve Mentorluk</h2>
      {assessments.length === 0 ? (
        <p className="next-status-note">Henüz görünür gelişim değerlendirmesi yok.</p>
      ) : (
        <div className="next-note-list">
          {assessments.map((assessment) => (
            <article key={assessment.id}>
              <strong>{assessment.periodLabel}</strong>
              <span className="next-field-hint">{assessment.createdAt ? formatDate(assessment.createdAt) : "Tarih yok"}</span>
              {assessment.mentorNote ? <p>{assessment.mentorNote}</p> : null}
              <table className="uh-data-table">
                <thead>
                  <tr>
                    <th>Kriter</th>
                    <th>Puan</th>
                    <th>Ölçek</th>
                  </tr>
                </thead>
                <tbody>
                  {assessment.scores.map((score) => (
                    <tr key={`${assessment.id}-${score.criterionId}`}>
                      <td>{score.criterionName}</td>
                      <td>{score.score}</td>
                      <td>
                        {score.scaleMin}-{score.scaleMax}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}
