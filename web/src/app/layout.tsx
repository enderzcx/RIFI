import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Web3Provider } from "@/components/providers/Web3Provider";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RIFI - AI Trading Agent",
  description: "AI-native trading agent on Base chain with Reactive Smart Contracts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans min-h-screen bg-[#0B0E11] text-zinc-100 antialiased`}>
        <Web3Provider>
          {children}

        </Web3Provider>
      </body>
    </html>
  );
}
