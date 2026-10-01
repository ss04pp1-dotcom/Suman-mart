"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  // Missing-token is derivable at first render — no setState-in-effect needed
  const [state, setState] = useState<"loading" | "ok" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its token.");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setState("ok");
        } else {
          setState("error");
          setMessage(d.error ?? "This verification link is invalid or has expired.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
        setMessage("Network error — please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex flex-col items-center text-center">
      {state === "loading" && (
        <>
          <Loader2 className="h-12 w-12 animate-spin text-brand-600" />
          <p className="mt-4 text-sm text-muted-foreground">Verifying your email…</p>
        </>
      )}
      {state === "ok" && (
        <>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Email verified!</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Thanks for confirming your email address. Happy shopping!
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link href="/account">Go to my account</Link>
          </Button>
        </>
      )}
      {state === "error" && (
        <>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40">
            <XCircle className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Verification failed</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{message}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            You can request a new link from Account → Security.
          </p>
          <Button asChild variant="outline" className="mt-6 rounded-full">
            <Link href="/account/security">Account security</Link>
          </Button>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
      <div className="rounded-3xl border border-border bg-card p-8">
        <Suspense
          fallback={
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <VerifyInner />
        </Suspense>
      </div>
    </div>
  );
}
