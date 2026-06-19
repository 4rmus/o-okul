"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { ActionCard, Button, MetricCard, MetricGrid as UiMetricGrid, Panel, Skeleton, type MetricCardProps, type StatusBadgeProps } from "@uzman-hocam/ui";
import { useAuth } from "../../../providers.js";
import { PageFrame } from "../../_shared/page-frame.js";

interface PortalFrameProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface PortalWorkspaceProps {
  ariaLabel: string;
  main: ReactNode;
  side: ReactNode;
}

interface PortalMetricItem {
  description?: ReactNode;
  label: string;
  tone?: MetricCardProps["tone"];
  value: number | string;
}

const demoLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true" || process.env.NODE_ENV !== "production";

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
      <Panel
        aria-label="Portal erişimi"
        description={
          demoLoginEnabled
            ? "Portalı görmek için ilgili kişi hesabıyla giriş yapın. Demo/local ortamda hızlı önizleme için aşağıdaki düğmeyi kullanın."
            : "Portalı görmek için ilgili kişi hesabıyla giriş yapın."
        }
        title="Portal erişimi"
      >
        {demoLoginEnabled ? (
          <>
            <div className="next-portal-preview-action" aria-label="Demo ortam portal önizleme">
              <Button onClick={() => void previewAs()}>{demoLabel} olarak önizle</Button>
            </div>
            <p className="next-status-note">Demo giriş bilgisi yalnız demo/local hızlı önizleme düğmesine bağlıdır.</p>
          </>
        ) : null}
        {error ? <p className="next-form-error">{error}</p> : null}
      </Panel>
    </PortalFrame>
  );
}

export function MetricGrid({ items }: { items: PortalMetricItem[] }) {
  return (
    <UiMetricGrid aria-label="Portal özeti" className="next-portal-summary-grid" role="region">
      {items.map((item) => (
        <MetricCard
          className="next-portal-summary-card"
          description={item.description ?? portalMetricDescription(item)}
          key={item.label}
          label={item.label}
          tone={item.tone ?? portalMetricTone(item)}
          value={item.value}
        />
      ))}
    </UiMetricGrid>
  );
}

export function PortalWorkspace({ ariaLabel, main, side }: PortalWorkspaceProps) {
  return (
    <section className="next-portal-workspace" aria-label={ariaLabel}>
      <div className="next-portal-workspace__main">{main}</div>
      <aside className="next-portal-workspace__side" aria-label={`${ariaLabel} yan bağlam`}>
        {side}
      </aside>
    </section>
  );
}

export function PortalStatePanel({
  description,
  state,
  title,
}: {
  description: string;
  state: "empty" | "error" | "loading";
  title: string;
}) {
  return (
    <Panel
      aria-busy={state === "loading" ? "true" : undefined}
      aria-label={title}
      className="next-portal-state"
      description={description}
      data-state={state}
      role={state === "error" ? "alert" : "status"}
      title={title}
    >
      <p className="next-section-eyebrow">{stateLabel(state)}</p>
      {state === "loading" ? (
        <div className="next-portal-state__skeleton" aria-hidden="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}
    </Panel>
  );
}

export function RolePreviewNotice() {
  return (
    <Panel
      aria-label="Rol önizleme modu"
      className="next-portal-preview-notice"
      description="Bu ekran kurum yöneticisi için geçici rol önizleme modunda açıldı. Yazma işlemleri ve kişi aksiyonları kapalıdır."
      title="Salt-okuma Önizleme"
    >
      <p className="next-section-eyebrow">Önizleme</p>
    </Panel>
  );
}

export interface PortalDailyBriefItem {
  label: string;
  value: string;
  detail?: string;
  tone?: "critical" | "info" | "neutral" | "success" | "warning";
}

export interface PortalActionItem {
  actionLabel: string;
  contextLabel?: string;
  detail: string;
  href: string;
  key: string;
  label: string;
  statusLabel?: string;
  tone?: StatusBadgeProps["tone"];
  value: string;
}

export function PortalDailyBrief({
  items,
  summary,
  title = "Günlük durum",
}: {
  items: PortalDailyBriefItem[];
  summary: string;
  title?: string;
}) {
  return (
    <Panel
      actions={<p className="next-portal-brief__summary">{summary}</p>}
      aria-label={title}
      className="next-portal-brief"
      description={<span className="next-section-eyebrow">Bugünün odağı</span>}
      title={title}
    >
      <UiMetricGrid aria-label={`${title} metrikleri`} className="next-portal-brief__grid" role="group">
        {items.map((item) => (
          <MetricCard
            className="next-portal-brief__item"
            description={item.detail}
            key={`${item.label}-${item.value}`}
            label={item.label}
            tone={portalDailyBriefMetricTone(item.tone)}
            value={item.value}
          />
        ))}
      </UiMetricGrid>
    </Panel>
  );
}

function portalDailyBriefMetricTone(tone: PortalDailyBriefItem["tone"]): MetricCardProps["tone"] {
  if (tone === "critical" || tone === "warning") return "warning";
  if (tone === "success") return "success";
  if (tone === "info") return "info";
  return "default";
}

export function PortalActionStrip({
  ariaLabel,
  eyebrow = "Günlük iş kuyruğu",
  items,
  title = "Öncelikli aksiyonlar",
}: {
  ariaLabel: string;
  eyebrow?: string;
  items: PortalActionItem[];
  title?: string;
}) {
  const attentionCount = items.filter((item) => item.tone === "warning" || item.tone === "danger").length;
  return (
    <Panel
      actions={
        <div
          className="next-portal-action-strip__summary"
          aria-label={`${items.length} aksiyon, ${attentionCount} öncelikli`}
        >
          <span>{items.length} aksiyon</span>
          <strong>{attentionCount > 0 ? `${attentionCount} öncelikli` : "Rutin akış"}</strong>
        </div>
      }
      aria-label={ariaLabel}
      className="next-portal-action-strip"
      description={<span className="next-section-eyebrow">{eyebrow}</span>}
      title={title}
    >
      <div className="next-portal-action-strip__grid">
        {items.map((item) => (
          <ActionCard
            as="a"
            aria-label={portalActionAriaLabel(item)}
            badge={item.actionLabel}
            badgeTone={item.tone ?? "neutral"}
            className="next-portal-action-strip__item"
            context={item.contextLabel ?? "Portal"}
            detail={item.detail}
            href={item.href}
            key={item.key}
            label={item.label}
            onClick={(event) => focusPortalActionTarget(event, item.href)}
            state={item.statusLabel}
            tone={item.tone ?? "neutral"}
            value={item.value}
          />
        ))}
      </div>
    </Panel>
  );
}

function portalActionAriaLabel(item: PortalActionItem) {
  return [
    `${item.label}: ${item.value}`,
    item.contextLabel,
    item.actionLabel,
    item.statusLabel,
    item.detail,
  ]
    .filter(Boolean)
    .join(" · ");
}

function portalMetricDescription(item: PortalMetricItem) {
  if (item.label === "Başarı") return "Başarı % ana metrik";
  if (item.label === "Net") return "Soru sayısı bağlamıyla okunur";
  if (item.label === "Soru") return "Sınav kapsamı";
  if (item.label.includes("Ödeme")) return "Finans görünürlüğü izin kapsamına bağlıdır";
  if (item.label === "Önizleme") return "Rol önizleme davranışı";
  return "Portal kapsamındaki günlük durum";
}

function portalMetricTone(item: PortalMetricItem): MetricCardProps["tone"] {
  if (item.label === "Başarı") return "success";
  if (item.label === "Net" || item.label === "Soru") return "info";
  if (String(item.value) === "Kapalı") return "warning";
  return "default";
}

function focusPortalActionTarget(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("#") || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }

  const target = document.getElementById(href.slice(1));
  if (!target) return;

  event.preventDefault();
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  target.classList.add("next-portal-focus-target");
  target.scrollIntoView({ block: "start", inline: "nearest" });
  target.focus({ preventScroll: true });
  if (window.location.hash !== href) {
    window.history.pushState(null, "", href);
  }
}

const rolePreviewTokenStorageKey = "uzman-hocam.role-preview-token";

export function storeRolePreviewToken(token: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(rolePreviewTokenStorageKey, token);
}

export function readRolePreviewToken(searchParams: Pick<URLSearchParams, "get">) {
  if (searchParams.get("rolePreviewToken")) return "";
  if (searchParams.get("rolePreview") !== "1") return "";
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(rolePreviewTokenStorageKey)?.trim() ?? "";
}

function stateLabel(state: "empty" | "error" | "loading") {
  if (state === "loading") return "Hazırlanıyor";
  if (state === "error") return "Kontrol gerekiyor";
  return "Boş durum";
}
