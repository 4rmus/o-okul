import type { ReactNode } from "react";
import { AppShell } from "./app-shell.js";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
