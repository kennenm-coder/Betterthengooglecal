"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/client";
import {
  Mail,
  Lock,
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle,
  User,
} from "lucide-react";

type Mode = "sign-in" | "sign-up";
type Status =
  | "idle"
  | "checking"
  | "submitting"
  | "error"
  | "not-allowed"
  | "requesting"
  | "requested"
  | "already-exists";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [requestName, setRequestName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function clearErrors() {
    if (
      status === "not-allowed" ||
      status === "error" ||
      status === "already-exists"
    ) {
      setStatus("idle");
      setErrorMsg("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) return;

    if (mode === "sign-up" && (!firstName.trim() || !lastName.trim())) {
      setStatus("error");
      setErrorMsg("First and last name are required.");
      return;
    }

    if (mode === "sign-up" && password !== confirmPassword) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }

    if (mode === "sign-up" && password.length < 6) {
      setStatus("error");
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    setStatus("checking");
    setErrorMsg("");

    try {
      const supabase = createAuthClient();

      // Use RPC function — returns boolean only, no table exposure
      const { data: isAllowed, error: lookupError } = await supabase
        .rpc("is_email_allowed", { check_email: trimmedEmail });

      if (lookupError) {
        setStatus("error");
        setErrorMsg("Could not verify access. Try again.");
        return;
      }

      if (mode === "sign-up") {
        // Always create the auth account, even if not yet approved.
        // This way the user doesn't have to re-register after approval.
        setStatus("submitting");
        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
            },
          },
        });

        if (error) {
          setStatus("error");
          setErrorMsg(error.message);
          return;
        }

        if (data.user?.identities?.length === 0) {
          setStatus("already-exists");
          return;
        }

        if (isAllowed) {
          // Already on the allowlist — update their name and sign in
          await supabase
            .from("allowed_emails")
            .update({ name: fullName })
            .eq("email", trimmedEmail);
          router.push("/");
          router.refresh();
        } else {
          // Not yet approved — auto-submit an access request
          const { data: existing } = await supabase
            .from("access_requests")
            .select("id")
            .eq("email", trimmedEmail)
            .maybeSingle();

          if (!existing) {
            await supabase.from("access_requests").insert({
              email: trimmedEmail,
              name: fullName,
            });
          }

          // Sign them out so middleware doesn't redirect-loop
          await supabase.auth.signOut();
          setStatus("requested");
        }
        return;
      }

      // Sign-in flow — must be on the allowlist
      if (!isAllowed) {
        setStatus("not-allowed");
        return;
      }

      setStatus("submitting");

      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setStatus("error");
        if (error.message === "Invalid login credentials") {
          setErrorMsg("Wrong email or password.");
        } else {
          setErrorMsg(error.message);
        }
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  async function handleRequestAccess() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;

    setStatus("requesting");
    setErrorMsg("");

    try {
      const supabase = createAuthClient();

      const { data: existing } = await supabase
        .from("access_requests")
        .select("id")
        .eq("email", trimmedEmail)
        .maybeSingle();

      if (existing) {
        setStatus("requested");
        return;
      }

      const { error } = await supabase.from("access_requests").insert({
        email: trimmedEmail,
        name: requestName.trim() || null,
      });

      if (error) {
        setStatus("error");
        setErrorMsg("Could not submit request. Try again.");
        return;
      }

      setStatus("requested");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  const busy = status === "checking" || status === "submitting";

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
            <h1 className="text-xl font-semibold">
              {mode === "sign-in"
                ? "Sign in to Duck Force"
                : "Create your account"}
            </h1>
            <p className="text-sm text-muted">
              {mode === "sign-in"
                ? "Enter your work email and password"
                : "Pick a password for your account"}
            </p>
          </div>

          {/* Request submitted confirmation */}
          {status === "requested" ? (
            /* Request submitted confirmation */
            <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-success mx-auto" />
              <div>
                <p className="font-medium">Request submitted</p>
                <p className="text-sm text-muted mt-1">
                  An admin will review your request for{" "}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
                <p className="text-xs text-muted mt-3">
                  Your account is ready — just sign in once approved.
                </p>
              </div>
              <button
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                  setRequestName("");
                }}
                className="text-sm text-primary font-medium mt-2"
              >
                Done
              </button>
            </div>
          ) : status === "not-allowed" || status === "requesting" ? (
            /* Request access form */
            <div className="space-y-4">
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center space-y-1">
                <ShieldCheck className="w-8 h-8 text-warning mx-auto" />
                <p className="font-medium text-sm">Not on the access list</p>
                <p className="text-xs text-muted">
                  Request access and an admin will review it.
                </p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                    disabled={status === "requesting"}
                    className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                  />
                </div>

                <button
                  onClick={handleRequestAccess}
                  disabled={status === "requesting"}
                  className="w-full py-3.5 rounded-xl bg-warning text-black font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {status === "requesting" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Request Access"
                  )}
                </button>

                <button
                  onClick={() => {
                    setStatus("idle");
                    setErrorMsg("");
                  }}
                  className="w-full text-sm text-muted"
                >
                  Try a different email
                </button>
              </div>
            </div>
          ) : (
            /* Normal sign-in / sign-up form */
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearErrors();
                    }}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    autoComplete="email"
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                  />
                </div>

                {mode === "sign-up" && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => {
                          setFirstName(e.target.value);
                          clearErrors();
                        }}
                        placeholder="First name"
                        required
                        autoComplete="given-name"
                        disabled={busy}
                        className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => {
                          setLastName(e.target.value);
                          clearErrors();
                        }}
                        placeholder="Last name"
                        required
                        autoComplete="family-name"
                        disabled={busy}
                        className="w-full rounded-xl border border-border bg-background px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                      />
                    </div>
                  </div>
                )}

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearErrors();
                    }}
                    placeholder="Password"
                    required
                    autoComplete={
                      mode === "sign-in" ? "current-password" : "new-password"
                    }
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                  />
                </div>

                {mode === "sign-up" && (
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted pointer-events-none" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        clearErrors();
                      }}
                      placeholder="Confirm password"
                      required
                      autoComplete="new-password"
                      disabled={busy}
                      className="w-full rounded-xl border border-border bg-background pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-60"
                    />
                  </div>
                )}

                {status === "already-exists" && (
                  <div className="flex items-start gap-2 text-warning">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs">
                      This email already has an account.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setMode("sign-in");
                          setPassword("");
                          setConfirmPassword("");
                          setStatus("idle");
                        }}
                        className="text-primary font-medium"
                      >
                        Sign in instead
                      </button>
                    </p>
                  </div>
                )}

                {status === "error" && (
                  <div className="flex items-start gap-2 text-danger">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs">{errorMsg}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!email.trim() || !password || busy}
                  className="w-full py-3.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {status === "checking"
                        ? "Checking access..."
                        : mode === "sign-in"
                          ? "Signing in..."
                          : "Creating account..."}
                    </>
                  ) : mode === "sign-in" ? (
                    "Sign In"
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              {mode === "sign-in" && (
                <p className="text-center">
                  <a
                    href="/forgot-password"
                    className="text-xs text-muted hover:text-primary"
                  >
                    Forgot password?
                  </a>
                </p>
              )}

              <p className="text-center text-sm">
                {mode === "sign-in" ? (
                  <>
                    <span className="text-muted">First time? </span>
                    <button
                      onClick={() => {
                        setMode("sign-up");
                        setPassword("");
                        setConfirmPassword("");
                        setFirstName("");
                        setLastName("");
                        setStatus("idle");
                        setErrorMsg("");
                      }}
                      className="text-primary font-medium"
                    >
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-muted">
                      Already have an account?{" "}
                    </span>
                    <button
                      onClick={() => {
                        setMode("sign-in");
                        setPassword("");
                        setConfirmPassword("");
                        setStatus("idle");
                        setErrorMsg("");
                      }}
                      className="text-primary font-medium"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>

              <p className="text-xs text-center text-muted">
                Only approved team members can sign in.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
