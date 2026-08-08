"use client";

import { useState } from "react";
import { Button } from "@o-okul/ui";

type DemoActionsProps = {
  email: string;
  mailtoHref: string;
};

export function DemoActions({ email, mailtoHref }: DemoActionsProps) {
  const [copyStatus, setCopyStatus] = useState("");

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email);
      setCopyStatus("E-posta adresi kopyalandı.");
    } catch {
      setCopyStatus("Kopyalanamadı. Aşağıdaki adresi seçip kopyalayın.");
    }
  }

  return (
    <div>
      <div className="next-marketing-actions">
        <a className="uh-button uh-button--primary uh-button--md" href={mailtoHref}>E-posta taslağı oluştur</a>
        <Button variant="secondary" type="button" onClick={copyEmail}>E-posta adresini kopyala</Button>
      </div>
      <p aria-live="polite">{copyStatus}</p>
      <p>Seçip kopyalayabileceğiniz adres: <strong>{email}</strong></p>
    </div>
  );
}
