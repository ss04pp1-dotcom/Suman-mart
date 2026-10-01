"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, LifeBuoy, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AdminPageHeader } from "@/components/admin/page-header";

interface MeResponse {
  success: boolean;
  data?: {
    admin?: {
      id: string;
      name: string;
      email: string;
      totpEnabled: boolean;
      mustChangePassword: boolean;
      recoveryCodesRemaining?: number;
    } | null;
  };
}

export default function AdminSecurityPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useQuery<MeResponse>({
    queryKey: ["admin-me-security"],
    queryFn: async () => {
      const res = await fetch("/api/admin/auth/me");
      return res.json();
    },
  });

  // ── Password change ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // ── TOTP ──
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  // One-time recovery codes (shown exactly once — never refetchable)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [regenCode, setRegenCode] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);

  const totpEnabled = me?.data?.admin?.totpEnabled ?? false;
  const remaining = me?.data?.admin?.recoveryCodesRemaining ?? 0;

  const changePassword = async () => {
    if (newPassword !== confirmPassword) return toast.error("The passwords do not match");
    setPwLoading(true);
    try {
      const res = await fetch("/api/admin/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Password updated", { description: "Other sessions have been signed out." });
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      } else {
        toast.error(data.error ?? "Password change failed");
      }
    } finally {
      setPwLoading(false);
    }
  };

  const totpAction = async (action: "setup" | "enable" | "disable" | "regenerate-recovery") => {
    setTotpLoading(true);
    try {
      const res = await fetch("/api/admin/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action !== "setup" && action !== "regenerate-recovery" ? { code } : {}) }),
      });
      const data = await res.json();
      if (data.success) {
        if (action === "setup") {
          setSetup(data.data);
          toast.info("Scan or type the secret into your authenticator app", {
            description: "Then enter a current code below to confirm.",
          });
        } else if (action === "enable") {
          setSetup(null); setCode("");
          setRecoveryCodes(data.data.recoveryCodes ?? null);
          toast.success("Two-factor authentication enabled", {
            description: "Store your recovery codes somewhere safe — they are shown only once.",
          });
        } else if (action === "regenerate-recovery") {
          setRegenCode("");
          setRecoveryCodes(data.data.recoveryCodes ?? null);
          toast.success("New recovery codes generated");
        } else {
          setCode("");
          setRecoveryCodes(null);
          toast.success("Two-factor authentication disabled");
        }
        // refresh me
        queryClient.invalidateQueries({ queryKey: ["admin-me-security"] });
        queryClient.invalidateQueries({ queryKey: ["admin-me"] });
      } else {
        toast.error(data.error ?? "Action failed");
      }
    } finally {
      setTotpLoading(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Copy failed — select the codes manually");
    }
  };

  return (
    <div>
      <AdminPageHeader title="Security" description="Your account password and two-factor authentication" />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Password */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Change Password</CardTitle>
              <CardDescription>Changing your password signs out all other sessions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="cur">Current password</Label>
                <Input id="cur" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="npw">New password</Label>
                  <Input id="npw" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 10 characters" />
                </div>
                <div>
                  <Label htmlFor="cpw">Confirm</Label>
                  <Input id="cpw" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <Button
                className="rounded-xl"
                disabled={pwLoading || !currentPassword || newPassword.length < 10 || newPassword !== confirmPassword}
                onClick={changePassword}
              >
                {pwLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
              </Button>
            </CardContent>
          </Card>

          {/* Two-factor */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4" /> Two-Factor Authentication
                <Badge variant="outline" className={totpEnabled ? "border-emerald-300 text-emerald-700" : "text-muted-foreground"}>
                  {totpEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </CardTitle>
              <CardDescription>
                Require a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) at sign-in
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recoveryCodes ? (
                <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                  <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                    <LifeBuoy className="h-4 w-4" /> Recovery codes — shown only this once
                  </p>
                  <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/80">
                    Each code signs you in exactly once if you ever lose your authenticator device.
                    Copy them somewhere safe now — they cannot be shown again.
                  </p>
                  <div className="mt-3 grid gap-1.5 rounded-lg bg-card p-3 font-mono text-[13px] sm:grid-cols-2">
                    {recoveryCodes.map((c) => (
                      <span key={c} className="tracking-wider">{c}</span>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-3 rounded-xl" onClick={copyRecoveryCodes}>
                    <Copy className="mr-2 h-3.5 w-3.5" /> Copy codes
                  </Button>
                </div>
              ) : totpEnabled ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>Two-factor is active.</span>
                    <Badge variant="outline" className={remaining > 0 ? "border-emerald-300 text-emerald-700" : "border-amber-400 text-amber-700"}>
                      {remaining} recovery code{remaining === 1 ? "" : "s"} left
                    </Badge>
                  </div>
                  {remaining === 0 && (
                    <p className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      You have no unused recovery codes. If you lose your authenticator device you will be
                      locked out of the console — generate a fresh set below.
                    </p>
                  )}
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Enter a current code to disable 2FA</p>
                    <div className="flex gap-2">
                      <Input
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="123456"
                        className="max-w-[160px] rounded-xl tracking-[0.3em]"
                      />
                      <Button variant="outline" className="rounded-xl text-rose-600" disabled={totpLoading || code.length !== 6} onClick={() => totpAction("disable")}>
                        {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />} Disable 2FA
                      </Button>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Regenerate recovery codes (invalidates the current set)</p>
                    <div className="flex gap-2">
                      <Input
                        value={regenCode}
                        onChange={(e) => setRegenCode(e.target.value.toUpperCase())}
                        placeholder="6-digit code or a recovery code"
                        className="max-w-[280px] rounded-xl"
                      />
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={regenLoading || regenCode.trim().length < 6}
                        onClick={async () => {
                          setRegenLoading(true);
                          try {
                            const res = await fetch("/api/admin/auth/totp", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "regenerate-recovery", code: regenCode.trim() }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              setRecoveryCodes(data.data.recoveryCodes ?? null);
                              setRegenCode("");
                              toast.success("New recovery codes generated");
                              queryClient.invalidateQueries({ queryKey: ["admin-me-security"] });
                            } else {
                              toast.error(data.error ?? "Regeneration failed");
                            }
                          } finally {
                            setRegenLoading(false);
                          }
                        }}
                      >
                        {regenLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LifeBuoy className="mr-2 h-4 w-4" />} Regenerate
                      </Button>
                    </div>
                  </div>
                </>
              ) : setup ? (
                <>
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-semibold">1. Add this secret to your authenticator app</p>
                    <p className="mt-2 break-all rounded-lg bg-card px-3 py-2 font-mono text-base tracking-wider">{setup.secret}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Or open the otpauth link manually (some apps support paste):<br />
                      <span className="break-all font-mono text-[10px]">{setup.uri}</span>
                    </p>
                    <Separator className="my-3" />
                    <p className="font-semibold">2. Enter the current 6-digit code to confirm</p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456"
                      className="max-w-[160px] rounded-xl tracking-[0.3em]"
                    />
                    <Button className="rounded-xl" disabled={totpLoading || code.length !== 6} onClick={() => totpAction("enable")}>
                      {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} Confirm & enable
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Add a second factor so a stolen password alone cannot access the console.
                  </p>
                  <Button variant="outline" className="rounded-xl" disabled={totpLoading} onClick={() => totpAction("setup")}>
                    {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />} Set up authenticator
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
