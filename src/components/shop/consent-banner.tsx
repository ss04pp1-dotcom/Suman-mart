"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useConsent } from "@/lib/stores/consent";
import { getSessionKey } from "@/lib/tracking-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Cookie } from "lucide-react";

// No-op subscription for the hydration gate below.
const emptySubscribe = () => () => {};

export function ConsentBanner() {
  const consent = useConsent();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  // Wait for the persisted consent state to rehydrate before deciding whether
  // to show the banner — otherwise returning visitors see a one-frame flash.
  // useSyncExternalStore is the canonical hydration gate: it renders the server
  // snapshot (false) during hydration, then flips to true on the client without
  // a setState-in-effect.
  const getClientSnapshot = useCallback(() => true, []);
  const getServerSnapshot = useCallback(() => false, []);
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted || consent.decided) return null;

  const submit = async (choice: "ACCEPT_ALL" | "ESSENTIAL_ONLY" | "CUSTOM" | "REJECTED", a = false, m = false) => {
    consent.decide(choice, a, m);
    setPrefsOpen(false);
    // Persist the choice server-side for consent analytics (signed session)
    try {
      const sessionKey = await getSessionKey();
      if (!sessionKey) return;
      await fetch("/api/tracking/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, choice, analytics: a, marketing: m }),
      });
    } catch {
      /* consent persistence is best-effort */
    }
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 animate-fade-in-up">
        <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card/95 p-4 shadow-card-hover backdrop-blur sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3 sm:flex-1">
              <div className="rounded-full bg-brand-50 p-2 text-brand-600 dark:bg-brand-100">
                <Cookie className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">We value your privacy</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  We use cookies to improve your experience, analyze traffic and measure advertising
                  performance.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
              <Button variant="outline" size="sm" onClick={() => submit("ESSENTIAL_ONLY")}>
                Essential Only
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPrefsOpen(true)}>
                Manage Preferences
              </Button>
              <Button size="sm" onClick={() => submit("ACCEPT_ALL")}>
                Accept All
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Choose which cookies we may use. Essential cookies are required for the store to work
              and cannot be disabled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Essential Cookies</p>
                <p className="text-xs text-muted-foreground">
                  Cart, session and security. Always active.
                </p>
              </div>
              <Switch checked disabled aria-label="Essential cookies (always on)" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Analytics Cookies</p>
                <p className="text-xs text-muted-foreground">
                  Help us understand how the store is used (first-party, anonymized).
                </p>
              </div>
              <Switch checked={analytics} onCheckedChange={setAnalytics} aria-label="Allow analytics cookies" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Marketing Cookies</p>
                <p className="text-xs text-muted-foreground">
                  Used to measure ads on Meta, Google and TikTok.
                </p>
              </div>
              <Switch checked={marketing} onCheckedChange={setMarketing} aria-label="Allow marketing cookies" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => submit("ESSENTIAL_ONLY")}>
              Reject Non-Essential
            </Button>
            <Button onClick={() => submit("CUSTOM", analytics, marketing)}>Save Preferences</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
