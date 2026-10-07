import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, Literata } from "next/font/google";

import { brand } from "@/config/brand";

import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: brand.product, template: `%s · ${brand.product}` },
  description: brand.description,
  applicationName: brand.product,
  creator: brand.company,
  publisher: brand.company,
  openGraph: {
    type: "website",
    siteName: brand.product,
    title: brand.product,
    description: brand.description,
  },
  twitter: { card: "summary", title: brand.product, description: brand.description },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${cormorant.variable} ${literata.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
