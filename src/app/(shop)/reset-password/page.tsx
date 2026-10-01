"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("The passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Password reset!", { description: "Sign in with your new password." });
        router.push("/login");
      } else {
        toast.error(data.error ?? "Reset failed", {
          description: "Request a new link if this one has expired.",
        });
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        This reset link is missing its token. Please request a fresh link from the{" "}
        <Link href="/forgot-password" className="font-semibold underline">forgot password</Link> page.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat the new password" />
      </div>
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading || password.length < 8 || password !== confirmPassword}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
        Reset password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
      <div className="rounded-3xl border border-border bg-card p-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Choose a new password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your new password signs out all other devices.
        </p>
        <Suspense>
          <ResetForm />
        </Suspense>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
