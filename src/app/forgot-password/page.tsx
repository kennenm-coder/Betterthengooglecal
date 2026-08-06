"use client";

import { useState } from "react";
import Link from "next/link";
import { createAuthClient } from "@/lib/supabase/client";
import { ArrowLeft, Mail, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setStatus("sending");
    setErrorMsg("");

    try {
      const supabase = createAuthClient();
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });

      if (error) {
        setStatus("error");
        setErrorMsg(error.message);
      } else {
        setStatus("sent");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon-192.png"
                alt="Duck Force"
                className="w-16 h-16 rounded-2xl"
              />
            </div>
            <h1 className="text-xl font-semibold">Reset Your Password</h1>
            <p className="text-sm text-muted">
              Enter your email and we&apos;ll send a reset link.
            </p>
          </div>

          {status === "sent" ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-success mx-auto" />
              <div>
                <p className="font-medium">Check your email</p>
                <p className="text-sm text-muted mt-1">
                  We sent a reset link to{" "}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
                <p className="text-xs text-muted mt-3">
                  Don&apos;t see it? Check your spam folder.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm text-primary font-medium mt-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status === "error") {
                        setStatus("idle");
                        setErrorMsg("");
                      }
                    }}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    autoComplete="email"
                    disabled={status === "sending"}
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
                  disabled={!email.trim() || status === "sending"}
                  className="w-full py-3.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </button>
              </form>

              <p className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
