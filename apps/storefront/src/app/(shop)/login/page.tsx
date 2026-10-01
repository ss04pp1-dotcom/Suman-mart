"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogIn, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/account";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Welcome back, ${data.data.name.split(" ")[0]}!`);
        router.push(next);
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
        <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-600">
            Forgot password?
          </Link>
        </div>
        <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
        Sign In
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to ShopNest?{" "}
        <Link href="/register" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 lg:flex-row lg:items-center lg:py-20">
      {/* Visual */}
      <div className="relative hidden min-h-[460px] flex-1 overflow-hidden rounded-3xl lg:block">
        <Image src="/banners/hero-shopping-1.jpg" alt="Shopping at ShopNest" fill sizes="600px" className="object-cover" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />
        <div className="absolute bottom-0 p-10">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-lg font-extrabold">ShopNest</span>
          </div>
          <h2 className="mt-4 max-w-sm text-2xl font-extrabold text-white">
            Welcome back to your nest of great finds
          </h2>
          <p className="mt-2 max-w-sm text-sm text-slate-300">
            Track orders, manage addresses and check out faster with your saved details.
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-3xl border border-border bg-card p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Use your email and password to continue.</p>
          <div className="mt-7">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
