"use client";

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
  return (
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
        {rows.length > 0 ? (
          rows.map((row) => (
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
