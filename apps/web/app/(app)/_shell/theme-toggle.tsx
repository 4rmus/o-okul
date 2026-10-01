"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@o-okul/ui";

type Theme = "light" | "dark";

// Berrak §1: tema <html data-theme> ile seçilir; ilk boyama layout.tsx'teki inline script'tedir.
// Tercih yalnız tema anahtarıdır (kimlik/oturum verisi değil, DEC-20260930-01).
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Masaüstü ve mobil anahtar aynı anda bağlıdır; ikisi de kaynağı (data-theme) izler.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributeFilter: ["data-theme"], attributes: true });
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("o-okul-theme", next);
    } catch {
      // Depolama kapalıysa tercih yalnız bu sayfa için geçerli kalır.
    }
  }

  const isDark = theme === "dark";
  return (
    <Button aria-label="Koyu tema" aria-pressed={isDark} className={className} onClick={toggle} size="icon" title="Koyu tema" type="button" variant="secondary">
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </Button>
  );
}
