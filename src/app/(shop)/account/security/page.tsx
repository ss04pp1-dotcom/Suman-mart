"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, KeyRound, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountSecurityPage() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);

  // Load email verification status
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setEmailVerified(Boolean(d?.data?.customer?.emailVerifiedAt)))
      .catch(() => setEmailVerified(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Password updated", {
          description: "For your security you have been signed out — please sign in again.",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 1500);
      } else {
        toast.error(data.error ?? "Could not update password");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const resendVerification = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Verification email sent", { description: "Check your inbox (and spam folder)." });
      } else {
        toast.error(data.error ?? "Could not send the email");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Password &amp; Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">Keep your account secure with a strong password.</p>
      </div>

      {/* Email verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MailCheck className="h-4 w-4 text-brand-600" /> Email address
          </CardTitle>
          <CardDescription>Verified email lets you recover your account and receive order updates.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {emailVerified === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : emailVerified ? (
            <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified
            </Badge>
          ) : (
            <>
              <Badge variant="outline" className="text-amber-600">Not verified</Badge>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={resendVerification} disabled={sending}>
                {sending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Send verification email
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-brand-600" /> Change password
          </CardTitle>
          <CardDescription>Use at least 8 characters. Mix letters, numbers and symbols.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="current">Current password</Label>
              <Input id="current" type="password" required autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
            </div>
            <Button type="submit" className="rounded-xl" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update Password
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <p>
          Your password is stored using PBKDF2-SHA256 hashing with 600,000 iterations — it is never
          stored in plain text. Changing it signs out all other devices, and sessions expire
          automatically after 7 days.
        </p>
      </div>
    </div>
  );
}
