"use client";

import CrashScreen from "@/components/CrashScreen";

// Catches a crash on any screen (Calendar, Search, Write-Ups, ...) so the
// phone gets a reload button — or an automatic reload when the app is simply
// out of date — instead of Next.js's bare error message.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} reset={reset} />;
}
