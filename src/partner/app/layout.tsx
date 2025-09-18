import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientAuthGuard from "./components/client-auth-guard";

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
        {/* Client-side auth guard: keeps users from visiting /login and /register when logged in */}
        <ClientAuthGuard />
        {children}
        {/* Global overlay root for prompts/modals rendered via portal */}
        <div id="partner-overlay-root" />
      </body>
    </html>
  );
}
