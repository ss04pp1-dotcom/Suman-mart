"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CreditCard, Globe2, Loader2, Package, Save, Settings2, ShieldCheck, Truck, UserPlus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";

// ── Generic settings section ───────────────────────────────────
function SettingsSection({ settingKey, fields, title, description, icon: Icon }: {
  settingKey: string;
  fields: { key: string; label: string; type?: "text" | "number" | "switch" | "textarea"; hint?: string }[];
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings", settingKey],
    queryFn: async () => {
      const res = await fetch(`/api/admin/settings?key=${settingKey}`);
      const json = await res.json();
      return json.data as Record<string, Record<string, unknown>>;
    },
  });

  useEffect(() => {
    if (data?.[settingKey]) setValues(data[settingKey]);
  }, [data, settingKey]);

  const save = async () => {
    setSaving(true);
    try {
      // Send ONLY the fields this section renders — the stored settings object
      // may contain keys that are no longer writable (e.g. cardEnabled) and
      // the server validates strictly.
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        if (values[f.key] !== undefined) payload[f.key] = values[f.key];
      }
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, values: payload }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`${title} saved`);
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-brand-600" /> {title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)
        ) : (
          <>
            {fields.map((f) => (
              <div key={f.key}>
                {f.type === "switch" ? (
                  <div className="flex items-center justify-between rounded-xl border border-border p-4">
                    <div>
                      <p className="text-sm font-semibold">{f.label}</p>
                      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                    <Switch
                      checked={Boolean(values[f.key])}
                      onCheckedChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                      aria-label={f.label}
                    />
                  </div>
                ) : (
                  <>
                    <Label htmlFor={`${settingKey}-${f.key}`}>{f.label}</Label>
                    <Input
                      id={`${settingKey}-${f.key}`}
                      type={f.type === "number" ? "number" : "text"}
                      value={String(values[f.key] ?? "")}
                      onChange={(e) => setValues((s) => ({ ...s, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
                      className="rounded-xl"
                    />
                    {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
                  </>
                )}
              </div>
            ))}
            <Button onClick={save} disabled={saving} className="rounded-xl">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save {title}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Team management (Security tab) ─────────────────────────────
interface TeamMember {
  id: string; name: string; email: string; role: string; isActive: boolean;
  lastLoginAt: string | null; createdAt: string; permissions: string[] | null;
}

function TeamManagement() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "SUPPORT", password: "" });

  const { data: members, isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const res = await fetch("/api/admin/team");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as TeamMember[];
    },
  });

  const addMember = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("Team member added");
        setOpen(false);
        setForm({ name: "", email: "", role: "SUPPORT", password: "" });
        queryClient.invalidateQueries({ queryKey: ["team"] });
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  };

  const toggleMember = async (m: TeamMember) => {
    const res = await fetch("/api/admin/team", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, isActive: !m.isActive }),
    });
    const json = await res.json();
    if (json.success) {
      toast.success(m.isActive ? "Member deactivated" : "Member activated");
      queryClient.invalidateQueries({ queryKey: ["team"] });
    } else toast.error(json.error);
  };

  const changeRole = async (m: TeamMember, role: string) => {
    const res = await fetch("/api/admin/team", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, role }),
    });
    if ((await res.json()).success) {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["team"] });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-brand-600" /> Team & Access Control</CardTitle>
            <CardDescription>Admin accounts and role-based permissions</CardDescription>
          </div>
          <Button size="sm" className="rounded-xl" onClick={() => setOpen(true)}><UserPlus className="mr-1.5 h-4 w-4" /> Add Member</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : (
          <div className="divide-y divide-border/60">
            {(members ?? []).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl gradient-brand text-xs font-bold text-white">
                  {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{m.name} {!m.isActive && <Badge variant="outline" className="ml-1 text-[10px]">Disabled</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{m.email} · last login {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "never"}</p>
                </div>
                <Select value={m.role} onValueChange={(v) => changeRole(m, v)}>
                  <SelectTrigger className="h-9 w-[150px] rounded-lg text-xs" aria-label={`Role for ${m.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="rounded-lg" onClick={() => toggleMember(m)}>
                  {m.isActive ? "Disable" : "Enable"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-border bg-muted/40 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Role permissions</p>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Super Admin", "Everything including team & security"],
              ["Admin", "All operations except team management"],
              ["Manager", "Catalog, orders, customers, suppliers"],
              ["Support", "Orders and customers only"],
              ["Marketing", "Analytics, campaigns, banners, coupons"],
            ].map(([role, desc]) => (
              <div key={role} className="rounded-lg bg-card p-2.5">
                <p className="font-bold">{role}</p>
                <p className="text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="t-name">Name</Label>
              <Input id="t-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="t-email">Email</Label>
              <Input id="t-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).filter(([k]) => k !== "SUPER_ADMIN").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-password">Temporary password</Label>
              <Input id="t-password" type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={addMember} disabled={saving || !form.name || !form.email || form.password.length < 8}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <AdminPageHeader title="Settings" description="Store configuration, payments, shipping and security" />

      <Tabs defaultValue="general">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 no-scrollbar sm:w-fit">
          <TabsTrigger value="general" className="rounded-xl px-4 py-2 text-sm">General</TabsTrigger>
          <TabsTrigger value="payment" className="rounded-xl px-4 py-2 text-sm">Payment</TabsTrigger>
          <TabsTrigger value="shipping" className="rounded-xl px-4 py-2 text-sm">Shipping</TabsTrigger>
          <TabsTrigger value="orders" className="rounded-xl px-4 py-2 text-sm">Orders</TabsTrigger>
          <TabsTrigger value="seo" className="rounded-xl px-4 py-2 text-sm">SEO</TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-xl px-4 py-2 text-sm">Notifications</TabsTrigger>
          <TabsTrigger value="security" className="rounded-xl px-4 py-2 text-sm">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <SettingsSection
            settingKey="general"
            title="General"
            description="Store identity and contact information"
            icon={Settings2}
            fields={[
              { key: "storeName", label: "Store name" },
              { key: "tagline", label: "Tagline" },
              { key: "supportPhone", label: "Support phone" },
              { key: "supportEmail", label: "Support email" },
              { key: "address", label: "Business address" },
              { key: "facebookUrl", label: "Facebook URL" },
              { key: "instagramUrl", label: "Instagram URL" },
            ]}
          />
        </TabsContent>

        <TabsContent value="payment" className="mt-4">
          <SettingsSection
            settingKey="payment"
            title="Payment Methods"
            description="COD works out of the box. bKash/Nagad run on manual verification: customers send money to your merchant number and submit the TrxID at checkout — verify it on the order page, then mark the payment PAID. Card payment requires a gateway integration and is disabled until one exists."
            icon={CreditCard}
            fields={[
              { key: "codEnabled", label: "Cash on Delivery", type: "switch", hint: "Customers pay the courier on arrival" },
              { key: "bkashEnabled", label: "bKash (manual verification)", type: "switch", hint: "Customer sends money to your bKash number and submits the TrxID; you verify it on the order" },
              { key: "bkashNumber", label: "bKash merchant number", hint: "Shown to the customer at checkout — the number they Send Money to" },
              { key: "nagadEnabled", label: "Nagad (manual verification)", type: "switch", hint: "Customer sends money to your Nagad number and submits the TrxID; you verify it on the order" },
              { key: "nagadNumber", label: "Nagad merchant number", hint: "Shown to the customer at checkout — the number they Send Money to" },
            ]}
          />
          <Card className="mt-4 border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-muted-foreground" /> Card payment
              </CardTitle>
              <CardDescription>
                Card payment is <span className="font-semibold">unavailable</span> — no card gateway (Stripe / SSLCommerz / bKash API) is
                integrated in this build. Enabling it without a gateway would strand orders in UNPAID forever, so the option is
                locked. To add a real gateway, implement a payment provider module and wire it into
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">src/lib/checkout.ts</code>.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        <TabsContent value="shipping" className="mt-4">
          <SettingsSection
            settingKey="shipping"
            title="Shipping"
            description="Delivery pricing and time estimates"
            icon={Truck}
            fields={[
              { key: "flatRate", label: "Flat shipping rate (৳)", type: "number" },
              { key: "freeShippingThreshold", label: "Free shipping over (৳)", type: "number", hint: "0 disables free shipping" },
              { key: "codCharge", label: "COD handling charge (৳)", type: "number" },
              { key: "estimatedDaysMin", label: "Min delivery days", type: "number" },
              { key: "estimatedDaysMax", label: "Max delivery days", type: "number" },
            ]}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <SettingsSection
            settingKey="orders"
            title="Order Settings"
            description="Checkout behavior and inventory alerts"
            icon={Package}
            fields={[
              { key: "allowGuestCheckout", label: "Allow guest checkout", type: "switch", hint: "Customers can order without an account" },
              { key: "autoConfirmOrders", label: "Auto-confirm new orders", type: "switch", hint: "Skip manual confirmation step" },
              { key: "defaultLowStockThreshold", label: "Default low stock threshold", type: "number" },
              { key: "orderNote", label: "Order confirmation note" },
            ]}
          />
        </TabsContent>

        <TabsContent value="seo" className="mt-4">
          <SettingsSection
            settingKey="seo"
            title="SEO Defaults"
            description="Default meta tags for the storefront (per-product SEO is set on each product)"
            icon={Globe2}
            fields={[
              { key: "defaultTitle", label: "Default page title" },
              { key: "defaultDescription", label: "Default meta description" },
              { key: "keywords", label: "Keywords (comma separated)" },
            ]}
          />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <SettingsSection
            settingKey="notifications"
            title="Notifications"
            description="Choose which events create admin notifications"
            icon={Bell}
            fields={[
              { key: "newOrderAlerts", label: "New orders", type: "switch" },
              { key: "lowStockAlerts", label: "Low stock", type: "switch" },
              { key: "syncFailureAlerts", label: "Supplier sync failures", type: "switch" },
              { key: "reviewAlerts", label: "New reviews", type: "switch" },
              { key: "trackingErrorAlerts", label: "Tracking API errors", type: "switch" },
            ]}
          />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <TeamManagement />
          <Card className="mt-4">
            <CardContent className="p-5 text-sm text-muted-foreground">
              <p className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <span>
                  <strong className="text-foreground">Security practices in place:</strong> PBKDF2-SHA256 password
                  hashing (100k iterations), signed httpOnly session cookies, same-origin checks on all mutations,
                  rate limiting on auth and tracking endpoints, full audit logging of sensitive admin actions, and
                  server-side authorization on every API route. Pixel and supplier credentials are stored
                  server-side only and never sent to the browser.
                </span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
