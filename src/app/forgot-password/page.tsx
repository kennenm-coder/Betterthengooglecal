"use client";

import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <Construction className="w-14 h-14 text-warning mx-auto" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Password Reset Coming Soon</h1>
            <p className="text-sm text-muted">
              This feature hasn&apos;t been set up yet. In the meantime, contact
              procurement to get your password reset.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-primary font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
