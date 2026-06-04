import { Suspense, type ReactNode } from "react";
import { AppShell } from "./app-shell.js";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
