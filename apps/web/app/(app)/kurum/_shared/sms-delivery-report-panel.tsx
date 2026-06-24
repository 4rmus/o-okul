"use client";

import { Alert, Button, MetricCard, MetricGrid, Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";

export interface SmsBatchDeliveryReportRecord {
  id: string;
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "queued" | "completed" | "failed";
  providerErrorCode?: string;
}

interface SmsDeliveryReportPanelProps {
  isError: boolean;
  isLoading: boolean;
  jobId: string;
  onRefresh: () => void;
  report?: SmsBatchDeliveryReportRecord;
}

export function SmsDeliveryReportPanel({
  isError,
  isLoading,
  onRefresh,
  report,
}: SmsDeliveryReportPanelProps) {
  return (
    <Panel
      aria-label="SMS teslim raporu"
      className="next-sms-delivery-panel"
      title="Teslim raporu"
      description="Kuyruk durumu, gönderim sonucu ve faturalandırılabilir segmentler."
      actions={
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Yenile
        </Button>
      }
    >
      {isLoading ? (
        <Alert title="Rapor yükleniyor">SMS teslim durumu güncelleniyor.</Alert>
      ) : isError ? (
        <Alert tone="danger" title="Rapor alınamadı">
          SMS teslim raporu şu anda okunamıyor.
        </Alert>
      ) : report ? (
        <>
          <MetricGrid aria-label="SMS teslim metrikleri" role="region">
            <MetricCard
              label="Durum"
              tone={smsDeliveryMetricTone(report.status)}
              value={
                <StatusBadge tone={smsDeliveryStatusTone(report.status)}>
                  {smsDeliveryStatusLabel(report.status)}
                </StatusBadge>
              }
              description="Kuyruk yaşam döngüsü"
            />
            <MetricCard label="Alıcı" value={report.recipientCount} description="İş kuyruğuna alınan" />
            <MetricCard label="Gönderilen" tone="success" value={report.sentCount} description="Provider kabulü" />
            <MetricCard
              label="Başarısız"
              tone={report.failedCount > 0 ? "danger" : "default"}
              value={report.failedCount}
              description={report.failedCount > 0 ? "Müdahale gerekli" : "Hata yok"}
            />
            <MetricCard label="Segment" value={report.billableSegments} description="Faturalandırılabilir" />
          </MetricGrid>
          {report.providerErrorCode ? (
            <Alert tone="danger" title="Provider hatası">
              {report.providerErrorCode}
            </Alert>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

function smsDeliveryStatusLabel(status: SmsBatchDeliveryReportRecord["status"]) {
  if (status === "completed") return "Tamamlandı";
  if (status === "failed") return "Başarısız";
  return "Kuyrukta";
}

function smsDeliveryStatusTone(status: SmsBatchDeliveryReportRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function smsDeliveryMetricTone(status: SmsBatchDeliveryReportRecord["status"]) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}
