"use client";

export interface OutcomeNetTableRow {
  courseName: string;
  id: string;
  net?: number;
  outcomeCode: string;
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
          <th scope="col">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.outcomeCode}</th>
              <td>{row.courseName}</td>
              <td>{formatNetNumber(row.net)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3}>{emptyLabel}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}
