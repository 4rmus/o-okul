import type { ReactNode } from "react";
import { Providers } from "./providers.js";
import "./globals.css";

export const metadata = {
  title: "Uzman Hocam",
  description: "Dershane otomasyon paneli",
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
