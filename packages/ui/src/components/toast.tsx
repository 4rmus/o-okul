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

// Tek aria-live bölgesi: eylem geri bildirimleri buradan okunur. Yükleme/ilerleme durumları
// kendi bileşenlerinde (LoadingState, DataTable) kalır.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const notify = useCallback((message: ReactNode, tone: ToastTone = "success") => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current.slice(-2), { id, message, tone }]);
    timers.current.set(id, setTimeout(() => dismiss(id), toastDurationMs));
  }, [dismiss]);

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-atomic="false" aria-live="polite" className="uh-toast-region">
        {items.map((item) => (
          <div className={classNames("uh-toast", `uh-toast--${item.tone}`)} key={item.id}>
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
