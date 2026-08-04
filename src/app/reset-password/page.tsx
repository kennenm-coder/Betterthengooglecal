"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/client";
import { Lock, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 6) {
      setStatus("error");
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirm) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }

    setStatus("saving");

    const supabase = createAuthClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("done");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 2000);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt="Duck Force"
              className="w-16 h-16 rounded-2xl mx-auto"
            />
            <h1 className="text-xl font-semibold">Reset Your Password</h1>
            <p className="text-sm text-muted">Enter a new password below</p>
          </div>

          {status === "done" ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-success mx-auto" />
              <p className="font-medium">Password updated</p>
              <p className="text-sm text-muted">Redirecting you to the app...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                  placeholder="New password"
                  required
                  autoFocus
                  autoComplete="new-password"
                  disabled={status === "saving"}
                  className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                  placeholder="Confirm new password"
                  required
                  autoComplete="new-password"
                  disabled={status === "saving"}
                  className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                />
              </div>

              {status === "error" && (
                <div className="flex items-start gap-2 text-danger">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{errorMsg}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!password || !confirm || status === "saving"}
                className="w-full py-3.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {status === "saving" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Update Password"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
