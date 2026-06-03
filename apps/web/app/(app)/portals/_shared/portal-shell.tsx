"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@uzman-hocam/ui";
import { useAuth } from "../../../providers.js";
import { PageFrame } from "../../_shared/page-frame.js";
import { MetricPanelGrid } from "../../_shared/metric-panel-grid.js";

interface PortalFrameProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PortalFrame({ actions, children, subtitle, title }: PortalFrameProps) {
  return (
    <PageFrame title={title} subtitle={subtitle} actions={actions}>
      <div className="next-portal-stack">{children}</div>
    </PageFrame>
  );
}

export function AccessPanel({ title, demoEmail, demoLabel }: { title: string; demoEmail: string; demoLabel: string }) {
  const { login } = useAuth();
  const [error, setError] = useState("");

  async function previewAs() {
    setError("");
    try {
      await login(demoEmail, "password");
    } catch {
      setError("Demo girişi başarısız.");
    }
  }

  return (
    <PortalFrame title={title} subtitle="Bu portal kişiye özeldir; kurum hesabıyla içerik görünmez.">
      <section className="next-list-panel">
        <p className="next-status-note">
          Portalı görmek için ilgili kişi hesabıyla giriş yapın. Demo ortamda hızlı önizleme için aşağıdaki düğmeyi kullanın.
        </p>
        <div className="next-portal-preview-action">
          <Button onClick={() => void previewAs()}>{demoLabel} olarak önizle</Button>
        </div>
        <p className="next-status-note">Demo hesap: {demoEmail} / password</p>
        {error ? <p className="next-form-error">{error}</p> : null}
      </section>
    </PortalFrame>
  );
}

export function MetricGrid({ items }: { items: Array<{ label: string; value: number | string }> }) {
  return <MetricPanelGrid ariaLabel="Portal özeti" metrics={items} />;
}
