"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show the same neutral confirmation (no account enumeration)
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
      <div className="rounded-3xl border border-border bg-card p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-100">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight">Forgot your password?</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter the email you use for ShopNest and we will send you a reset link.
        </p>

        {sent ? (
          <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
              <MailCheck className="h-5 w-5" /> Check your inbox
            </p>
            <p className="mt-1.5 text-sm text-emerald-700/80 dark:text-emerald-300/80">
              If an account exists for <span className="font-semibold">{email}</span>, a reset link is on its
              way. The link expires in 1 hour.
            </p>
            <p className="mt-3 text-xs text-emerald-700/60 dark:text-emerald-300/60">
              Don&apos;t see it? Check the spam folder, or contact support if the problem persists.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading || !email}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send reset link
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
