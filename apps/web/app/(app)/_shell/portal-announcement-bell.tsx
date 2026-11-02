"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@o-okul/ui";
import type { AnnouncementRecord, StudentRecord } from "@o-okul/shared-types";
import { ApiRequestError, apiBaseUrl, apiRequest, licenseReadOnlyEvent } from "../../../src/api-client.js";
import { useAuth } from "../../providers.js";
import { hasSubjectPortalAccess } from "../_shared/access.js";
import { formatDate } from "../_shared/format.js";
import {
  collectPortalUnreadAnnouncements,
  guardianAnnouncementsQueryKey,
  guardianStudentsQueryKey,
  studentAnnouncementsQueryKey,
  type PortalUnreadAnnouncement,
} from "./portal-announcement-unread.js";

const popoverItemLimit = 5;

type PortalBellPersona = "GUARDIAN" | "STUDENT";

// DEC-20261102-06: öğrenci ve veli kabuğunda okunmamış duyuru göstergesi. Öğretmen ve kurum kullanıcısında çizilmez.
export function PortalAnnouncementBell() {
  const { auth } = useAuth();
  const session = auth?.session;
  const persona: PortalBellPersona | undefined = !session
    ? undefined
    : hasSubjectPortalAccess(session, "STUDENT", "STUDENT")
      ? "STUDENT"
      : hasSubjectPortalAccess(session, "GUARDIAN", "GUARDIAN")
        ? "GUARDIAN"
        : undefined;
  if (!auth || !persona) return null;
  return <PortalAnnouncementBellView accessToken={auth.accessToken} persona={persona} userId={auth.session.userId} />;
}

function PortalAnnouncementBellView({ accessToken, persona, userId }: { accessToken: string; persona: PortalBellPersona; userId: string }) {
  const queryClient = useQueryClient();
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [licenseReadOnly, setLicenseReadOnly] = useState(false);
  const [markError, setMarkError] = useState("");
  const [markingId, setMarkingId] = useState("");

  // Liste uçları portal sayfasıyla aynı sorgu anahtarını kullanır; kabuk yüklenirken her kişi için en çok bir istek gider.
  const studentQuery = useQuery({
    queryKey: studentAnnouncementsQueryKey(userId),
    queryFn: () => apiRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/student/announcements`),
    enabled: persona === "STUDENT",
    refetchOnWindowFocus: false,
  });
  const wardsQuery = useQuery({
    queryKey: guardianStudentsQueryKey(userId),
    queryFn: () => apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students`),
    enabled: persona === "GUARDIAN",
    refetchOnWindowFocus: false,
  });
  const wardIds = persona === "GUARDIAN" ? (wardsQuery.data ?? []).map((student) => student.id) : [];
  const wardQueries = useQueries({
    queries: wardIds.map((studentId) => ({
      queryKey: guardianAnnouncementsQueryKey(userId, studentId),
      queryFn: () =>
        apiRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/announcements`),
      refetchOnWindowFocus: false,
    })),
  });

  useEffect(() => {
    // Salt okunur lisans yalnız bir yazma reddinde öğrenilir; uygulamanın herhangi bir yerindeki ret burada da geçerlidir.
    const onReadOnly = () => setLicenseReadOnly(true);
    window.addEventListener(licenseReadOnlyEvent, onReadOnly);
    return () => window.removeEventListener(licenseReadOnlyEvent, onReadOnly);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>(".next-portal-bell__trigger")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const sources =
    persona === "STUDENT"
      ? [{ announcements: studentQuery.data ?? [] }]
      : wardIds.map((studentId, index) => ({ announcements: wardQueries[index]?.data ?? [], studentId }));
  const unread = collectPortalUnreadAnnouncements(sources);
  const isLoading = persona === "STUDENT" ? studentQuery.isPending : wardsQuery.isPending || wardQueries.some((query) => query.isPending);
  const isError = persona === "STUDENT" ? studentQuery.isError : wardsQuery.isError || wardQueries.some((query) => query.isError);
  const hasCount = !isLoading && !isError;
  const count = unread.length;
  const href = persona === "STUDENT" ? "/ogrenci/duyurular" : "/veli/duyurular";
  // Velide her öğe kendi öğrencisinin duyuru listesine gider; portal sayfası kimliği bağlı öğrencilerle doğrular.
  const itemHref = (announcement: PortalUnreadAnnouncement) =>
    persona === "GUARDIAN" && announcement.studentId
      ? `${href}?${new URLSearchParams({ studentId: announcement.studentId }).toString()}`
      : href;
  const triggerLabel = hasCount ? `Okunmamış duyurular: ${count}` : "Okunmamış duyurular";

  function retry() {
    if (persona === "STUDENT") {
      void studentQuery.refetch();
      return;
    }
    if (wardsQuery.isError) void wardsQuery.refetch();
    for (const query of wardQueries) if (query.isError) void query.refetch();
  }

  async function markRead(announcement: PortalUnreadAnnouncement) {
    if (licenseReadOnly || markingId) return;
    setMarkingId(announcement.id);
    setMarkError("");
    const path =
      persona === "STUDENT"
        ? `me/student/announcements/${encodeURIComponent(announcement.id)}/read`
        : `me/guardian/students/${encodeURIComponent(announcement.studentId ?? "")}/announcements/${encodeURIComponent(announcement.id)}/read`;
    try {
      await apiRequest<AnnouncementRecord>(accessToken, `${apiBaseUrl}/${path}`, {
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      // Okundu bilgisi kişiye bağlıdır; velide aynı duyuru diğer çocukların listesinde de okunmuş görünür.
      if (persona === "STUDENT") {
        await queryClient.invalidateQueries({ exact: true, queryKey: studentAnnouncementsQueryKey(userId) });
      } else {
        await Promise.all(
          wardIds.map((studentId) => queryClient.invalidateQueries({ exact: true, queryKey: guardianAnnouncementsQueryKey(userId, studentId) })),
        );
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "TENANT_LICENSE_EXPIRED_READ_ONLY") {
        setLicenseReadOnly(true);
      } else {
        setMarkError("Okundu işaretlenemedi. Tekrar deneyin.");
      }
    } finally {
      setMarkingId("");
    }
  }

  const visibleItems = unread.slice(0, popoverItemLimit);
  return (
    <div className="next-portal-bell" ref={rootRef}>
      <Button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-label={triggerLabel}
        className="next-portal-bell__trigger"
        onClick={() => setOpen((current) => !current)}
        size="icon"
        title={triggerLabel}
        type="button"
        variant="secondary"
      >
        <Bell size={16} aria-hidden="true" />
        {hasCount && count > 0 ? (
          <span className="next-portal-bell__count" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Button>
      {open ? <section aria-label="Okunmamış duyurular" className="next-portal-bell__popover" id={popoverId}>
        <p className="next-portal-bell__header">
          <strong>Okunmamış duyurular</strong>
          {hasCount ? <span>{count > 0 ? `${count} duyuru` : "Güncel"}</span> : null}
        </p>
        {isLoading ? (
          <p className="next-portal-bell__note" role="status">
            Duyurular yükleniyor.
          </p>
        ) : isError ? (
          <div className="next-portal-bell__note" role="alert">
            <p>Duyurular şu an alınamadı.</p>
            <Button onClick={retry} size="sm" type="button" variant="secondary">
              Tekrar dene
            </Button>
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="next-portal-bell__note">Okunmamış duyuru yok.</p>
        ) : (
          <ul className="next-portal-bell__list">
            {visibleItems.map((announcement) => (
              <li key={announcement.id}>
                <Link href={itemHref(announcement)} onClick={() => setOpen(false)}>
                  <strong>{announcement.title}</strong>
                  <span>{formatDate(announcement.publishedAt)}</span>
                </Link>
                {licenseReadOnly ? null : (
                  <Button
                    aria-label={`${announcement.title} okundu işaretle`}
                    disabled={Boolean(markingId)}
                    loading={markingId === announcement.id}
                    loadingLabel="İşaretleniyor"
                    onClick={() => void markRead(announcement)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Okundu
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {licenseReadOnly ? (
          <p className="next-portal-bell__note" role="status">
            Lisans salt okunur; okundu işaretleme kapalı.
          </p>
        ) : null}
        {markError ? (
          <p className="next-portal-bell__note" role="alert">
            {markError}
          </p>
        ) : null}
        <Link className="next-portal-bell__all" href={href} onClick={() => setOpen(false)}>
          {count > visibleItems.length ? `Tüm duyurular (${count} okunmamış)` : "Tüm duyurular"}
        </Link>
      </section> : null}
    </div>
  );
}
