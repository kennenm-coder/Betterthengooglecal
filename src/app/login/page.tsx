"use client";

import { useState } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import { Mail, Loader2, CheckCircle, AlertCircle, ShieldCheck } from "lucide-react";

type Status = "idle" | "checking" | "sending" | "sent" | "not-allowed" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setStatus("checking");
    setErrorMsg("");

    try {
      const supabase = createAuthClient();

      const { data, error: lookupError } = await supabase
        .from("allowed_emails")
        .select("email")
        .eq("email", trimmed)
        .maybeSingle();

      if (lookupError) {
        setStatus("error");
        setErrorMsg("Could not verify access. Try again.");
        return;
      }

      if (!data) {
        setStatus("not-allowed");
        return;
      }

      setStatus("sending");

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (otpError) {
        setStatus("error");
        setErrorMsg(otpError.message);
        return;
      }

      setStatus("sent");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          {/* Logo */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon-192.png"
                alt="Duck Force"
                className="w-16 h-16 rounded-2xl"
              />
            </div>
            <h1 className="text-xl font-semibold">Sign in to Duck Force</h1>
            <p className="text-sm text-muted">
              Enter your work email to receive a sign-in link
            </p>
          </div>

          {/* Form */}
          {status === "sent" ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-success mx-auto" />
              <div>
                <p className="font-medium">Check your email</p>
                <p className="text-sm text-muted mt-1">
                  We sent a sign-in link to{" "}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
                <p className="text-xs text-muted mt-3">
                  Tap the link in the email to sign in. You can close this page.
                </p>
              </div>
              <button
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                }}
                className="text-sm text-primary font-medium mt-2"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status === "not-allowed" || status === "error") {
                        setStatus("idle");
                      }
                    }}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    autoComplete="email"
                    disabled={status === "checking" || status === "sending"}
                    className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                  />
                </div>

                {status === "not-allowed" && (
                  <div className="flex items-start gap-2 mt-2 text-danger">
                    <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs">
                      This email isn&apos;t on the access list. Contact your
                      admin to get added.
                    </p>
                  </div>
                )}

                {status === "error" && (
                  <div className="flex items-start gap-2 mt-2 text-danger">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs">{errorMsg}</p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  !email.trim() || status === "checking" || status === "sending"
                }
                className="w-full py-3.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {status === "checking" || status === "sending" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {status === "checking"
                      ? "Checking access..."
                      : "Sending link..."}
                  </>
                ) : (
                  "Send me a sign-in link"
                )}
              </button>
            </form>
          )}

          <p className="text-xs text-center text-muted">
            Only approved team members can sign in.
            <br />
            Links expire after 1 hour.
          </p>
        </div>
      </div>
    </div>
  );
}
