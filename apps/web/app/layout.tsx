import type { ReactNode } from "react";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { Providers } from "./providers.js";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
});

const displayFont = Source_Serif_4({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-source-serif-4",
  weight: ["600", "700"],
});

export const metadata = {
  title: appBrandTitle,
  applicationName: appBrand.name,
  metadataBase: new URL(appBrand.siteUrl),
  description:
    "TXT ve DAT optik verisini kontrol ederek Başarı % raporuna dönüştürmek ve öğrenci takibini sürdürmek isteyen eğitim kurumları için.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${bodyFont.variable} ${displayFont.variable}`}
      data-theme="almanac"
      lang="tr"
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
