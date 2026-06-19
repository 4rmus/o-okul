"use client";

import { useState } from "react";

export function RevealablePhone({
  canReveal = false,
  emptyLabel = "Telefon yok",
  value,
}: {
  canReveal?: boolean;
  emptyLabel?: string;
  value: string | undefined;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!value) {
    return <span className="next-revealable-phone next-revealable-phone--empty">{emptyLabel}</span>;
  }

  return (
    <span className="next-revealable-phone" data-revealed={revealed ? "true" : "false"}>
      <span>{revealed ? value : maskPhoneNumber(value)}</span>
      {canReveal ? (
        <button
          type="button"
          aria-label={revealed ? "Telefonu kapat" : "Telefonu aç"}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? "Gizle" : "Göster"}
        </button>
      ) : null}
    </span>
  );
}

export function maskPhoneNumber(value: string | undefined) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  return `••• ••• ••${digits.slice(-2).padStart(2, "•")}`;
}
