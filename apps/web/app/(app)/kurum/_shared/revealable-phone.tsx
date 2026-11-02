"use client";

import { useState } from "react";
import { Button } from "@o-okul/ui";

import { formatPhone, maskPhone } from "../../_shared/format.js";

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
      <span>{revealed ? formatPhone(value) : maskPhone(value)}</span>
      {canReveal ? (
        <Button
          aria-label={revealed ? "Telefonu kapat" : "Telefonu aç"}
          onClick={() => setRevealed((current) => !current)}
          size="sm"
          variant="ghost"
        >
          {revealed ? "Gizle" : "Göster"}
        </Button>
      ) : null}
    </span>
  );
}
