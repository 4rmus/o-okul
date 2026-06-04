"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { CampusRecord, ClassRecord, GradeLevelRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

export function ClassDetailPage({ classId }: { classId: string }) {
  const { auth } = useAuth();
  const detailQuery = useQuery({
    queryKey: ["next-class-detail", auth?.session.tenantId ?? "anonymous", classId],
    queryFn: () => loadClassDetail(auth?.accessToken ?? "", classId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data;

  return (
    <PageFrame
      title={detail?.record.name ?? "Sınıf detayı"}
      subtitle="Sınıf detayı"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/siniflar">
          <ArrowLeft size={17} aria-hidden="true" />
          Sınıflara dön
        </Link>
      }
    >
      <section className="next-report-panel" aria-label="Sınıf detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Sınıf detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <MetricPanelGrid
              ariaLabel="Sınıf özeti"
              metrics={[
                { label: "Seviye", value: detail.gradeLevelName ?? detail.record.level ?? "-" },
                { label: "Şube", value: detail.record.section ?? "-" },
                { label: "Kampüs", value: detail.campusName ?? "-" },
                { label: "Öğrenci", value: detail.students.length },
              ]}
            />
            <section className="next-report-list" aria-label="Sınıf öğrencileri">
              <h2>Öğrenciler</h2>
              {detail.students.length > 0 ? (
                detail.students.map((student) => (
                  <p key={student.id}>
                    <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`}>
                      {student.firstName} {student.lastName}
                    </Link>
                  </p>
                ))
              ) : (
                <p>Öğrenci yok</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadClassDetail(accessToken: string, classId: string) {
  const [record, campuses, gradeLevels, students] = await Promise.all([
    apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(classId)}`),
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
  ]);

  return {
    campusName: campuses.data.find((campus) => campus.id === record.campusId)?.name,
    gradeLevelName: gradeLevels.data.find((gradeLevel) => gradeLevel.id === record.gradeLevelId)?.name,
    record,
    students: students.data.filter((student) => student.classId === classId),
  };
}
