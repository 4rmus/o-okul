import type { ReactNode } from "react";
import { Providers } from "./providers.js";
import "./globals.css";

export const metadata = {
  title: "Uzman Hocam | Eğitim Kurumu Yönetim Platformu",
  description: "Dershane, özel okul ve kurs merkezleri için öğrenci takip, veli iletişimi ve kurum yönetim platformu.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
