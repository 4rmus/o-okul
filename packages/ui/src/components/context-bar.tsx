import type { ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface ContextBarOption {
  label: string;
  value: string;
}

export interface ContextBarSelect {
  // Görünür etiket ("Kampüs") ile erişilebilir ad ("Çalışma kampüsü") ayrıdır; sayfa filtreleriyle çakışmaz.
  accessibleName: string;
  allLabel: string;
  label: string;
  onChange(value: string): void;
  options: ContextBarOption[];
  value: string;
}

export interface ContextBarProps {
  className?: string;
  label: string;
  // Seçenekler tembel yüklenir: kullanıcı bir seçiciye ilk odaklandığında çağrılır.
  onActivate?: () => void;
  selects: ContextBarSelect[];
  staticItems?: Array<{ label: string; value: ReactNode }>;
}

// Çalışma bağlamı (UI-01): kampüs/dönem seçimi URL'e yazılır; tenant seçimi login'de kalır.
export function ContextBar({ className, label, onActivate, selects, staticItems = [] }: ContextBarProps) {
  return (
    <div aria-label={label} className={classNames("uh-context-bar", className)} role="group">
      {staticItems.map((item) => (
        <span className="uh-context-bar__item" key={item.label}>
          <span className="uh-context-bar__label">{item.label}</span>
          <strong>{item.value}</strong>
        </span>
      ))}
      {selects.map((select) => (
        <span className="uh-context-bar__item" key={select.label}>
          <span aria-hidden="true" className="uh-context-bar__label">{select.label}</span>
          <select aria-label={select.accessibleName} onChange={(event) => select.onChange(event.target.value)} onFocus={onActivate} onPointerDown={onActivate} value={select.value}>
            <option value="">{select.allLabel}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      ))}
    </div>
  );
}
