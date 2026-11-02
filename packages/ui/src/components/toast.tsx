"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { classNames } from "../class-names.js";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
}

interface ToastApi {
  notify(message: ReactNode, tone?: ToastTone): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const toastDurationMs = 6000;
// Hata bildirimi kendiliğinden kapanmaz; kullanıcı okuyup kapatır.
const toastDurationByTone: Record<ToastTone, number | null> = {
  danger: null,
  neutral: toastDurationMs,
  success: toastDurationMs,
  warning: toastDurationMs,
};

interface ToastTimer {
  handle?: ReturnType<typeof setTimeout>;
  remainingMs: number;
  startedAt: number;
}

// Tek aria-live bölgesi: eylem geri bildirimleri buradan okunur. Yükleme/ilerleme durumları
// kendi bileşenlerinde (LoadingState, DataTable) kalır. Fare üzerindeyken veya odak bölgedeyken
// süre durur, ayrılınca kalan süreden devam eder.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ToastTimer>());
  const isPaused = useRef({ focus: false, hover: false });
  const regionRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
  }, []);

  const startTimer = useCallback((id: number, timer: ToastTimer) => {
    clearTimeout(timer.handle);
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => dismiss(id), timer.remainingMs);
  }, [dismiss]);

  const pause = useCallback((reason: "focus" | "hover") => {
    const wasPaused = isPaused.current.focus || isPaused.current.hover;
    isPaused.current[reason] = true;
    if (wasPaused) return;
    timers.current.forEach((timer) => {
      if (timer.handle === undefined) return;
      clearTimeout(timer.handle);
      timer.handle = undefined;
      timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
    });
  }, []);

  const resume = useCallback((reason: "focus" | "hover") => {
    if (!isPaused.current[reason]) return;
    isPaused.current[reason] = false;
    if (isPaused.current.focus || isPaused.current.hover) return;
    timers.current.forEach((timer, id) => startTimer(id, timer));
  }, [startTimer]);

  const notify = useCallback((message: ReactNode, tone: ToastTone = "success") => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => {
      const next = [...current.slice(-2), { id, message, tone }];
      // En fazla üç bildirim görünür; listeden düşenin zamanlayıcısı da temizlenir.
      for (const item of current) {
        if (!next.includes(item)) {
          clearTimeout(timers.current.get(item.id)?.handle);
          timers.current.delete(item.id);
        }
      }
      return next;
    });
    const durationMs = toastDurationByTone[tone];
    if (durationMs === null) return;
    const timer: ToastTimer = { remainingMs: durationMs, startedAt: Date.now() };
    timers.current.set(id, timer);
    if (!isPaused.current.focus && !isPaused.current.hover) startTimer(id, timer);
  }, [startTimer]);

  // Kapatılan bildirim odak/fare altındaysa blur veya mouseleave gelmeyebilir; durum DOM'dan düzeltilir.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    if (isPaused.current.focus && !region.contains(document.activeElement)) resume("focus");
    if (isPaused.current.hover && !region.querySelector(".uh-toast:hover")) resume("hover");
  }, [items, resume]);

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => clearTimeout(timer.handle));
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-atomic="false"
        aria-live="polite"
        className="uh-toast-region"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume("focus");
        }}
        onFocus={() => pause("focus")}
        ref={regionRef}
      >
        {items.map((item) => (
          <div
            className={classNames("uh-toast", `uh-toast--${item.tone}`)}
            key={item.id}
            onMouseEnter={() => pause("hover")}
            onMouseLeave={() => resume("hover")}
          >
            <span className="uh-toast__message">{item.message}</span>
            <button aria-label="Bildirimi kapat" className="uh-toast__close" onClick={() => dismiss(item.id)} type="button">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast ToastProvider içinde kullanılmalı");
  return api;
}
