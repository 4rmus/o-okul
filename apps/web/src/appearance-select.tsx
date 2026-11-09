"use client";

import { useEffect, useState } from "react";
import { Select } from "@o-okul/ui";
import { applyAppearance, type Appearance } from "./appearance.js";

export function AppearanceSelect({ className }: { className?: string }) {
  const [appearance, setAppearance] = useState<Appearance>("whiteboard");

  // Desktop, mobile and public controls share the first-paint document state.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setAppearance(
      root.dataset.appearance === "plain" || root.dataset.appearance === "blackboard"
        ? root.dataset.appearance
        : "whiteboard",
    );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributeFilter: ["data-appearance", "data-theme"], attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <label className={["next-appearance-select", className].filter(Boolean).join(" ")}>
      <span>Görünüm</span>
      <Select aria-label="Görünüm" value={appearance} onChange={(event) => applyAppearance(event.currentTarget.value)}>
        <option value="plain">Sade</option>
        <option value="whiteboard">Beyaz tahta</option>
        <option value="blackboard">Kara tahta</option>
      </Select>
    </label>
  );
}
