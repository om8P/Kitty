import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Both fonts are SIL OFL 1.1; their licenses sit beside them in assets/fonts/.
const heading = localFont({
  src: "../../assets/fonts/PlusJakartaSans-Variable-Latin.woff2",
  weight: "200 800",
  variable: "--font-heading",
  display: "swap",
});

const body = localFont({
  src: "../../assets/fonts/Inter-Variable-Latin.woff2",
  weight: "100 900",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kitty",
  description: "Shared spending pools for families and AI agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
