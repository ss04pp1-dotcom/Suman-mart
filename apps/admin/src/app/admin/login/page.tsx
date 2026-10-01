"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogIn, ShieldCheck, Store, BarChart3, Boxes, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // The 2FA field accepts EITHER a 6-digit authenticator code OR a
      // one-time recovery code (XXXX-XXXX-XXXX-XXXX) — sent as the right
      // field so the server validates it on the correct path.
      const isTotp = /^\d{6}$/.test(totpCode);
      const twoFactor = totpCode
        ? isTotp
          ? { totpCode }
          : { recoveryCode: totpCode.trim().toUpperCase() }
        : {};
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...twoFactor }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data.totpRequired) {
          setTotpRequired(true);
          setError("Enter the 6-digit code from your authenticator app — or a recovery code.");
          return;
        }
        toast.success(`Welcome back, ${data.data.name.split(" ")[0]}!`, {
          description: `Signed in as ${data.data.role.replace("_", " ").toLowerCase()}`,
        });
        // Force a password change on first login (seeded / reset accounts)
        router.push(data.data.mustChangePassword ? "/admin/change-password" : next);
        router.refresh();
      } else {
        setError(data.error ?? "Login failed");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" placeholder="you@shopnest.com" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="h-11" />
      </div>
      {(totpRequired || totpCode.length > 0) && (
        <div>
          <Label htmlFor="totp" className="flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Two-factor code
          </Label>
          <Input
            id="totp"
            inputMode="text"
            maxLength={19}
            value={totpCode}
            onChange={(e) => {
              // 6 digits → authenticator code; anything else → recovery code
              const raw = e.target.value.toUpperCase();
              setTotpCode(/^\d*$/.test(raw) ? raw.slice(0, 6) : raw);
            }}
            placeholder="123456 or XXXX-XXXX-XXXX-XXXX"
            className="h-11 tracking-[0.2em]"
            autoComplete="one-time-code"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Lost your authenticator? Enter a one-time recovery code instead.
          </p>
        </div>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-400">{error}</p>
      )}
      <Button type="submit" size="lg" className="h-11 w-full rounded-xl" disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
        Sign In to Console
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Left panel */}
      <div className="relative hidden flex-1 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/40 via-slate-950 to-slate-950" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-brand text-white shadow-lg">
              <Store className="h-5 w-5" />
            </div>
            <span className="text-lg font-extrabold text-white">ShopNest Admin</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-4xl font-extrabold leading-tight text-white">
              Run your store like a <span className="text-emerald-400">pro</span>
            </h1>
            <p className="mt-4 text-slate-400">
              Real-time analytics, order management, dropshipping automation and campaign tracking —
              all in one console.
            </p>
            <div className="mt-8 space-y-4">
              {[
                { icon: BarChart3, text: "Live sales, conversion funnels and campaign performance" },
                { icon: Boxes, text: "Supplier sync, inventory and dropship order automation" },
                { icon: ShieldCheck, text: "Role-based access, 2FA and full audit trails" },
              ].map((f) => (
                <div key={f.text} className="flex items-center gap-3 text-sm text-slate-300">
                  <div className="rounded-lg bg-white/5 p-2 text-emerald-400">
                    <f.icon className="h-4 w-4" />
                  </div>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} ShopNest Technologies</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center p-6 lg:w-[480px]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-brand text-white">
              <Store className="h-5 w-5" />
            </div>
            <span className="text-lg font-extrabold text-white">ShopNest Admin</span>
          </div>
          <h2 className="text-2xl font-extrabold text-white">Sign in</h2>
          <p className="mt-1.5 text-sm text-slate-400">Access the ShopNest management console.</p>
          <div className="mt-8">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Customer? <Link href="/login" className="text-emerald-400 hover:underline">Go to store sign-in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
