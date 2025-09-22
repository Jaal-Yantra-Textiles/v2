import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthLayer from "./components/auth-layer";
import { Toaster } from "@medusajs/ui";
import TopLoader from "./components/top-loader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JYT Partner Space",
  description: "JYT Partner Space: manage everything here.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-ui-bg-subtle flex min-h-screen w-full items-center justify-center antialiased text-ui-fg-base`}
      >
        {/* Global route-change loader */}
        <TopLoader />
        {/* Unified auth layer: guards routes and handles 401/403 globally */}
        <AuthLayer />
        {children}
        {/* Global overlay root for prompts/modals rendered via portal */}
        <div id="partner-overlay-root" />
        {/* Global toast container */}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
