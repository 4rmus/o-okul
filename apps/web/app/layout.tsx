import type { ReactNode } from "react";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { Providers } from "./providers.js";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
});

const displayFont = Space_Grotesk({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

export const metadata = {
  title: appBrandTitle,
  applicationName: appBrand.name,
  metadataBase: new URL(appBrand.siteUrl),
  description:
    "Dershane ve özel öğretim kurumlarında öğrenci, sınıf, günlük yoklama, optik sınav, karne, ödeme planı ve duyuru yönetimi.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${bodyFont.variable} ${displayFont.variable}`} lang="tr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
