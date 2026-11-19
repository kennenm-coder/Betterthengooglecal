"use client";

import CrashScreen from "@/components/CrashScreen";
import "./globals.css";

// Last line of defence: a crash in the app's outer frame (the data loader that
// wraps every screen), which error.tsx can't catch. It replaces the whole
// page, so it brings its own <html> and <body>.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col bg-background text-foreground">
        <CrashScreen error={error} />
      </body>
    </html>
  );
}
