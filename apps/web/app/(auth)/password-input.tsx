"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Input, type InputProps } from "@o-okul/ui";

// Şifre göster/gizle (UI/UX F8). Anahtar, `<label>` dışında durur: etiket içinde olsaydı alanın
// erişilebilir adına "Şifreyi göster" eklenirdi. Durum PasswordField ↔ PasswordInput arasında
// context ile paylaşılır; Field/Input sözleşmesi (id, aria-describedby, aria-invalid) değişmez.
const PasswordVisibilityContext = createContext(false);

export function PasswordField({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <PasswordVisibilityContext.Provider value={visible}>
      <div className="next-password-field">
        {children}
        <Button
          aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
          aria-pressed={visible}
          className="next-password-field__toggle"
          onClick={() => setVisible((current) => !current)}
          size="icon"
          variant="ghost"
        >
          {visible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
        </Button>
      </div>
    </PasswordVisibilityContext.Provider>
  );
}

export function PasswordInput({ className, ...props }: InputProps) {
  const visible = useContext(PasswordVisibilityContext);
  return <Input {...props} className={["next-password-input", className].filter(Boolean).join(" ")} type={visible ? "text" : "password"} />;
}
