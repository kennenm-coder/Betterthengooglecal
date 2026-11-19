import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import DataProvider from "@/components/DataProvider";
import AutoRefresh from "@/components/AutoRefresh";
import ColorLoader from "@/components/ColorLoader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Duck Force",
  description: "Renewal by Andersen field operations calendar",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Duck Force",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a73e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <head />
      <body className="h-full flex flex-col">
        <ColorLoader />
        <DataProvider>
          <AutoRefresh />
          {children}
        </DataProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js');
              }
              // Android / desktop Chrome offer "install this app" once the page
              // loads — often before React is up. Hold on to that offer (and
              // stop Chrome's own banner) so the calendar's one-time card can
              // ask instead (PushInvite). iPhones never send this.
              window.addEventListener('beforeinstallprompt', function (e) {
                e.preventDefault();
                window.__duckInstallPrompt = e;
                window.dispatchEvent(new Event('duck-install-ready'));
              });
            `,
          }}
        />
      </body>
    </html>
  );
}
