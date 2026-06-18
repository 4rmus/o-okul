import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { classNames } from "../class-names.js";

export type TabsActivationMode = "automatic" | "manual";
export type TabsOrientation = "horizontal" | "vertical";

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  activationMode?: TabsActivationMode;
  label: string;
  orientation?: TabsOrientation;
}

export function Tabs({
  activationMode = "automatic",
  children,
  className,
  label,
  onKeyDown,
  orientation = "horizontal",
  ...props
}: TabsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isTabElement(event.target)) return;

    const enabledTabs = findEnabledTabs(event.currentTarget);
    const currentIndex = enabledTabs.indexOf(event.target);
    if (currentIndex === -1) return;

    const nextIndex = nextTabIndex(event.key, currentIndex, enabledTabs.length, orientation);
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = enabledTabs[nextIndex];
    if (!nextTab) return;
    nextTab.focus();
    if (activationMode === "automatic") {
      nextTab.click();
    }
  }

  return (
    <div
      {...props}
      aria-label={label}
      aria-orientation={orientation === "vertical" ? "vertical" : undefined}
      className={classNames("uh-tabs", className)}
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {children}
    </div>
  );
}

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function TabButton({ className, disabled, selected = false, tabIndex, type = "button", ...props }: TabButtonProps) {
  return (
    <button
      {...props}
      aria-selected={selected}
      className={classNames("uh-tab-button", selected && "uh-tab-button--selected", className)}
      disabled={disabled}
      role="tab"
      tabIndex={tabIndex ?? (selected && !disabled ? 0 : -1)}
      type={type}
    />
  );
}

export interface SegmentedControlProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  children: ReactNode;
}

export function SegmentedControl({ children, className, label, ...props }: SegmentedControlProps) {
  return (
    <div {...props} aria-label={label} className={classNames("uh-segmented-control", className)} role="group">
      {children}
    </div>
  );
}

function findEnabledTabs(tabList: HTMLElement) {
  return Array.from(tabList.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).filter(
    (tab) => !tab.disabled && tab.getAttribute("aria-disabled") !== "true" && tab.getClientRects().length > 0,
  );
}

function isTabElement(target: EventTarget | null): target is HTMLButtonElement {
  return target instanceof HTMLButtonElement && target.getAttribute("role") === "tab";
}

function nextTabIndex(key: string, currentIndex: number, tabCount: number, orientation: TabsOrientation) {
  if (tabCount === 0) return null;

  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (orientation !== "vertical" && key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (orientation !== "vertical" && key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  if (orientation !== "horizontal" && key === "ArrowDown") return (currentIndex + 1) % tabCount;
  if (orientation !== "horizontal" && key === "ArrowUp") return (currentIndex - 1 + tabCount) % tabCount;

  return null;
}
