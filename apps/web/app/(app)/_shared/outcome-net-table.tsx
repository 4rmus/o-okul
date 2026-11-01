"use client";

import { useState } from "react";
import { Button } from "@o-okul/ui";

// Kazanım tabloları telafi planı için okunur: en düşük başarı önce gelir, ilk görünüm bu kadar satırla sınırlıdır.
export const OUTCOME_TABLE_INITIAL_LIMIT = 12;

export function sortOutcomesWeakestFirst<T>(rows: T[], successRate: (row: T) => number | undefined): T[] {
  return [...rows].sort((first, second) => {
    const firstRate = successRate(first);
    const secondRate = successRate(second);
    if (firstRate === undefined || secondRate === undefined) return (firstRate === undefined ? 1 : 0) - (secondRate === undefined ? 1 : 0);
    return firstRate - secondRate;
  });
}

export function OutcomeRowLimitToggle({
  expanded,
  limit = OUTCOME_TABLE_INITIAL_LIMIT,
  onToggle,
  total,
}: {
  expanded: boolean;
  limit?: number;
  onToggle: () => void;
  total: number;
}) {
  if (total <= limit) return null;
  return (
    <div className="next-outcome-limit">
      <span aria-live="polite">
        {expanded ? `${total} kazanımın tamamı gösteriliyor.` : `En düşük başarılı ${limit} / ${total} kazanım gösteriliyor.`}
      </span>
      <Button size="sm" variant="secondary" onClick={onToggle}>
        {expanded ? `En düşük ${limit} kazanımı göster` : `Tüm kazanımları göster (${total})`}
      </Button>
    </div>
  );
}

export interface OutcomeNetTableRow {
  courseName: string;
  id: string;
  net?: number;
  outcomeCode: string;
  questionCount?: number;
  successRate?: number;
}

export function OutcomeNetTable({
  caption,
  emptyLabel = "Kazanım verisi yok",
  rows,
}: {
  caption: string;
  emptyLabel?: string;
  rows: OutcomeNetTableRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, OUTCOME_TABLE_INITIAL_LIMIT);
  return (
    <>
      <table className="uh-chart-table uh-outcome-net-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Kazanım</th>
            <th scope="col">Ders</th>
            <th scope="col">Başarı</th>
            <th scope="col">Net</th>
            <th scope="col">Soru</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length > 0 ? (
            visibleRows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.outcomeCode}</th>
                <td>{row.courseName}</td>
                <td><SuccessMeter value={row.successRate} /></td>
                <td>{formatNetNumber(row.net)}</td>
                <td>{formatQuestionCount(row.questionCount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
      <OutcomeRowLimitToggle expanded={expanded} onToggle={() => setExpanded((current) => !current)} total={rows.length} />
    </>
  );
}

export function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function formatPercentNumber(value: number | undefined) {
  return value === undefined ? "-" : `%${value.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;
}

export function formatQuestionCount(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

function SuccessMeter({ value }: { value: number | undefined }) {
  const width = value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="next-success-meter">
      <span className="next-success-meter__track" aria-hidden="true">
        <span className="next-success-meter__fill" style={{ width: `${width}%` }} />
      </span>
      <span>{formatPercentNumber(value)}</span>
    </span>
  );
}
