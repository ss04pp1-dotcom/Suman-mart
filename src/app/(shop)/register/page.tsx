"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Package, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, password: form.password }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Welcome to ShopNest!", { description: "Your account has been created." });
        router.push("/account");
        router.refresh();
      } else {
        setError(data.error ?? "Registration failed");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 lg:flex-row lg:items-center lg:py-20">
      <div className="mx-auto w-full max-w-md lg:order-2">
        <div className="rounded-3xl border border-border bg-card p-8">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand text-white">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-lg font-extrabold">ShopNest</span>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight lg:mt-0">Create account</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Join ShopNest for faster checkout and order tracking.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Nusrat Jahan" autoComplete="name" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="you@example.com" autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="phone">Mobile number</Label>
              <Input id="phone" required inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="01XXXXXXXXX" autoComplete="tel" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" autoComplete="new-password" />
              </div>
              <div>
                <Label htmlFor="confirm">Confirm</Label>
                <Input id="confirm" type="password" required value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} placeholder="Repeat password" autoComplete="new-password" />
              </div>
            </div>
            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Create Account
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden flex-1 lg:block lg:order-1">
        <h2 className="text-3xl font-extrabold leading-tight">
          Everything you love,
          <br />
          delivered to your <span className="text-brand-600">nest</span>
        </h2>
        <ul className="mt-8 space-y-5">
          {[
            { title: "Faster checkout", text: "Save addresses and reorder in seconds." },
            { title: "Live order tracking", text: "Follow every step from packing to doorstep." },
            { title: "Members-only deals", text: "Early access to sales and special coupons." },
          ].map((f) => (
            <li key={f.title} className="flex gap-4">
              <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
              <div>
                <p className="font-semibold">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
