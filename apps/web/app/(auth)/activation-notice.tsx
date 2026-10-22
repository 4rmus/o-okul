"use client";

import { useEffect, useState } from "react";

// UAT F-20: after an activation the login page says so. Only this flag travels in the URL (no name, e-mail or
// student number), and it is removed again as soon as the notice is read.
const activationNoticeParam = "aktivasyon";
const activationNotices = {
  invitation: { flag: "tamam", message: "Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapın." },
  student: { flag: "ogrenci", message: "Hesabınız etkinleştirildi. Öğrenci numaranız ve yeni şifrenizle giriş yapın." },
} as const;

export type ActivationNoticeKind = keyof typeof activationNotices;

export function activationNoticeHref(loginPath: string, kind: ActivationNoticeKind): string {
  return `${loginPath}?${activationNoticeParam}=${activationNotices[kind].flag}`;
}

export function useActivationNotice(): string {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get(activationNoticeParam);
    if (flag === null) return;
    const match = Object.values(activationNotices).find((candidate) => candidate.flag === flag);
    if (match) setNotice(match.message);
    url.searchParams.delete(activationNoticeParam);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return notice;
}
