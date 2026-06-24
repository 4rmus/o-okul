import type { ReactNode } from "react";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { Providers } from "./providers.js";
import "./globals.css";

export const metadata = {
  title: appBrandTitle,
  applicationName: appBrand.name,
  metadataBase: new URL(appBrand.siteUrl),
  description: "Dershane, özel okul ve kurs merkezleri için öğrenci takip, veli iletişimi ve kurum yönetim platformu.",
  icons: {
    icon: "/icon.svg",
  },
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
