"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Banknote, Check, CreditCard, Loader2, Lock,
  MapPin, Package, ShieldCheck, Truck, Wallet,
} from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PublicSettings {
  guestEmailVerification: boolean;
  paymentMethods: {
    cod: boolean;
    bkash: boolean;
    bkashNumber: string;
    nagad: boolean;
    nagadNumber: string;
    card: boolean;
  };
  shipping: { flatRate: number; freeShippingThreshold: number; estimatedDaysMin: number; estimatedDaysMax: number; codCharge: number };
}

interface SavedAddress {
  id: string; label: string; fullName: string; phone: string; line1: string;
  line2: string | null; city: string; area: string | null; postalCode: string | null; isDefault: boolean;
}

const STEPS = [
  { id: 1, label: "Shipping", icon: MapPin },
  { id: 2, label: "Payment", icon: Wallet },
  { id: 3, label: "Review", icon: Package },
];

function CheckoutInner() {
  const cart = useCart();
  const router = useRouter();
  const params = useSearchParams();
  const couponFromUrl = params.get("coupon");

  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const [address, setAddress] = useState({
    fullName: "", phone: "", line1: "", line2: "", city: "", area: "", postalCode: "",
  });
  const [guestEmail, setGuestEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [guestOtp, setGuestOtp] = useState("");
  const [trxId, setTrxId] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "BKASH" | "NAGAD" | "CARD">("COD");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(couponFromUrl);
  const [totals, setTotals] = useState<{ subtotal: number; discount: number; shippingTotal: number; codCharge: number; total: number; freeShipping: boolean } | null>(null);
  const [cartErrors, setCartErrors] = useState<string[]>([]);

  // Load settings + user + addresses
  useEffect(() => {
    fetch("/api/settings/public").then((r) => r.json()).then((d) => d.success && setSettings(d.data)).catch(() => undefined);
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(async (d) => {
        if (d.data?.customer) {
          setUser(d.data.customer);
          const a = await fetch("/api/account/addresses").then((r) => r.json());
          if (a.success) {
            setAddresses(a.data);
            const def = a.data.find((x: SavedAddress) => x.isDefault) ?? a.data[0];
            if (def) {
              setSelectedAddressId(def.id);
              setAddress({
                fullName: def.fullName, phone: def.phone, line1: def.line1,
                line2: def.line2 ?? "", city: def.city, area: def.area ?? "", postalCode: def.postalCode ?? "",
              });
            }
          }
        }
      })
      .catch(() => undefined);
  }, []);

  // Server-validate cart whenever items/coupon change
  useEffect(() => {
    if (cart.items.length === 0) return;
    fetch("/api/cart/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
        couponCode: appliedCoupon,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setTotals(d.data.totals);
          setCartErrors(d.data.errors);
        }
      })
      .catch(() => undefined);
  }, [cart.items, appliedCoupon]);

  const subtotal = cart.subtotal();
  const shippingTotal = totals?.shippingTotal ?? (settings && subtotal >= settings.shipping.freeShippingThreshold ? 0 : settings?.shipping.flatRate ?? 60);
  const discount = totals?.discount ?? 0;
  const codCharge = paymentMethod === "COD" ? (totals?.codCharge ?? settings?.shipping.codCharge ?? 0) : 0;
  const total = (totals?.total ?? subtotal - discount + shippingTotal) + codCharge;

  // Round-4 audit: guests verify their email with a one-time code while a
  // mail provider is configured (the checkout API enforces the same policy).
  const guestOtpRequired = !user && Boolean(settings?.guestEmailVerification);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail.trim());
  const otpValid = /^\d{6}$/.test(guestOtp.trim());

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  const sendGuestOtp = async () => {
    if (!emailValid || otpSending || otpCooldown > 0) return;
    setOtpSending(true);
    try {
      const res = await fetch("/api/checkout/guest-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: guestEmail.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        setOtpCooldown(60);
        toast.success("Verification code sent", { description: "Check your inbox (and spam folder) — it expires in 10 minutes." });
      } else {
        toast.error(data.error ?? "Could not send the code");
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setOtpSending(false);
    }
  };

  const addressValid = useMemo(
    () =>
      address.fullName.trim().length >= 2 &&
      /^01[3-9]\d{8}$/.test(address.phone.trim()) &&
      address.line1.trim().length >= 4 &&
      address.city.trim().length >= 2 &&
      // Guests must leave an email — order confirmation + payment receipt
      (user !== null || emailValid) &&
      // …and prove it with the one-time code when the policy is active
      (!guestOtpRequired || otpValid),
    [address, user, emailValid, guestOtpRequired, otpValid]
  );

  const isManualPayment = paymentMethod === "BKASH" || paymentMethod === "NAGAD";
  const manualNumber =
    paymentMethod === "BKASH" ? settings?.paymentMethods.bkashNumber : paymentMethod === "NAGAD" ? settings?.paymentMethods.nagadNumber : "";
  const trxValid = /^[A-Za-z0-9-]{6,40}$/.test(trxId.trim());

  const paymentOptions = useMemo(() => {
    const pm = settings?.paymentMethods;
    return [
      { id: "COD" as const, label: "Cash on Delivery", desc: "Pay when your order arrives", icon: Banknote, enabled: pm ? pm.cod : true },
      { id: "BKASH" as const, label: "bKash", desc: "Send money, enter the TrxID — we verify within minutes", icon: Wallet, enabled: pm ? pm.bkash : false },
      { id: "NAGAD" as const, label: "Nagad", desc: "Send money, enter the TrxID — we verify within minutes", icon: CreditCard, enabled: pm ? pm.nagad : false },
      { id: "CARD" as const, label: "Card", desc: "Debit / credit card — coming soon", icon: CreditCard, enabled: pm ? pm.card : false },
    ];
  }, [settings]);

  const placeOrder = async () => {
    setPlacing(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
          couponCode: appliedCoupon,
          address: {
            fullName: address.fullName.trim(),
            phone: address.phone.trim(),
            line1: address.line1.trim(),
            line2: address.line2.trim() || null,
            city: address.city.trim(),
            area: address.area.trim() || null,
            postalCode: address.postalCode.trim() || null,
          },
          customerNote: customerNote.trim() || null,
          customerEmail: !user ? guestEmail.trim() : undefined,
          guestEmailOtp: !user && guestOtpRequired ? guestOtp.trim() : undefined,
          paymentTrxId: isManualPayment ? trxId.trim() : undefined,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        cart.clear();
        router.push(`/order-success/${data.data.orderNumber}`);
      } else {
        toast.error(data.error ?? "Checkout failed", {
          description: data.errors?.[0],
        });
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPlacing(false);
    }
  };

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
        <Package className="h-12 w-12 text-muted-foreground/50" />
        <h1 className="text-2xl font-extrabold">Nothing to checkout</h1>
        <p className="text-sm text-muted-foreground">Your cart is empty. Add some products first.</p>
        <Button asChild className="mt-2 rounded-full">
          <Link href="/products">Browse Products</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Checkout</h1>

      {/* Stepper */}
      <ol className="mt-6 flex items-center gap-2 sm:gap-4" aria-label="Checkout steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex flex-1 items-center gap-2 sm:gap-3">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors",
                step > s.id
                  ? "border-brand-600 bg-brand-600 text-white"
                  : step === s.id
                    ? "border-brand-600 text-brand-700 dark:text-brand-600"
                    : "border-border text-muted-foreground"
              )}
            >
              {step > s.id ? <Check className="h-4 w-4" /> : s.id}
            </div>
            <span className={cn("hidden text-sm font-semibold sm:block", step >= s.id ? "text-foreground" : "text-muted-foreground")}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className={cn("h-0.5 flex-1 rounded", step > s.id ? "bg-brand-600" : "bg-border")} />}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {/* STEP 1 — Shipping */}
          {step === 1 && (
            <section className="space-y-6" aria-label="Shipping information">
              {addresses.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Saved addresses</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {addresses.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setSelectedAddressId(a.id);
                          setAddress({
                            fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? "",
                            city: a.city, area: a.area ?? "", postalCode: a.postalCode ?? "",
                          });
                        }}
                        className={cn(
                          "rounded-2xl border p-4 text-left text-sm transition-all",
                          selectedAddressId === a.id ? "border-brand-600 bg-brand-50 dark:bg-brand-100" : "border-border hover:border-brand-300"
                        )}
                      >
                        <p className="font-semibold">{a.label}</p>
                        <p className="mt-1 text-muted-foreground">{a.fullName} · {a.phone}</p>
                        <p className="mt-0.5 text-muted-foreground">{a.line1}, {a.city}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-4 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="fullName">Full name *</Label>
                  <Input id="fullName" value={address.fullName} onChange={(e) => setAddress((a) => ({ ...a, fullName: e.target.value }))} placeholder="e.g. Nusrat Jahan" />
                </div>
                <div>
                  <Label htmlFor="phone">Mobile number *</Label>
                  <Input id="phone" inputMode="tel" value={address.phone} onChange={(e) => setAddress((a) => ({ ...a, phone: e.target.value }))} placeholder="01XXXXXXXXX" />
                  <p className="mt-1 text-xs text-muted-foreground">We will call before delivery</p>
                </div>
                <div>
                  <Label htmlFor="city">City *</Label>
                  <Input id="city" value={address.city} onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))} placeholder="e.g. Dhaka" />
                </div>
                {!user && (
                  <div className="sm:col-span-2">
                    <Label htmlFor="guestEmail">Email (for order confirmation) *</Label>
                    <div className="flex gap-2">
                      <Input
                        id="guestEmail"
                        type="email"
                        inputMode="email"
                        value={guestEmail}
                        onChange={(e) => {
                          setGuestEmail(e.target.value);
                          setOtpSent(false);
                          setGuestOtp("");
                        }}
                        placeholder="you@example.com"
                        className="min-w-0 flex-1"
                      />
                      {guestOtpRequired && (
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 rounded-xl"
                          disabled={!emailValid || otpSending || otpCooldown > 0}
                          onClick={sendGuestOtp}
                        >
                          {otpSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : otpSent ? "Resend code" : "Send code"}
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      We send your order confirmation and payment receipt here
                    </p>
                    {guestOtpRequired && (
                      <div className="mt-3">
                        <Label htmlFor="guestOtp">Email verification code *</Label>
                        <Input
                          id="guestOtp"
                          inputMode="numeric"
                          maxLength={6}
                          value={guestOtp}
                          onChange={(e) => setGuestOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="6-digit code from your email"
                          className="font-mono tracking-widest"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          We emailed a 6-digit code to <span className="font-medium text-foreground">{guestEmail.trim() || "your email"}</span> so we never send order mail to an address you don&apos;t own. It expires in 10 minutes.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Label htmlFor="line1">Address line *</Label>
                  <Input id="line1" value={address.line1} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} placeholder="House, Road, Area details" />
                </div>
                <div>
                  <Label htmlFor="area">Area / Landmark</Label>
                  <Input id="area" value={address.area} onChange={(e) => setAddress((a) => ({ ...a, area: e.target.value }))} placeholder="e.g. Dhanmondi" />
                </div>
                <div>
                  <Label htmlFor="postalCode">Postal code</Label>
                  <Input id="postalCode" value={address.postalCode} onChange={(e) => setAddress((a) => ({ ...a, postalCode: e.target.value }))} placeholder="1205" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="note">Order note (optional)</Label>
                  <Textarea id="note" rows={2} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Delivery instructions…" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="ghost" asChild>
                  <Link href="/cart"><ArrowLeft className="mr-2 h-4 w-4" /> Back to cart</Link>
                </Button>
                <Button
                  size="lg"
                  className="rounded-xl"
                  disabled={!addressValid}
                  onClick={() => setStep(2)}
                >
                  Continue to Payment <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </section>
          )}

          {/* STEP 2 — Payment */}
          {step === 2 && (
            <section className="space-y-6" aria-label="Payment method">
              <div className="space-y-3">
                {paymentOptions.map((pm) => (
                  <button
                    key={pm.id}
                    disabled={!pm.enabled}
                    onClick={() => {
                      setPaymentMethod(pm.id);
                      track("AddPaymentInfo", { value: total });
                    }}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition-all",
                      paymentMethod === pm.id ? "border-brand-600 bg-brand-50 dark:bg-brand-100" : "border-border hover:border-brand-300",
                      !pm.enabled && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <div className={cn("rounded-xl p-2.5", paymentMethod === pm.id ? "bg-brand-600 text-white" : "bg-muted text-muted-foreground")}>
                      <pm.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">
                        {pm.label}
                        {!pm.enabled && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Soon</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{pm.desc}</p>
                    </div>
                    <div className={cn("h-5 w-5 rounded-full border-2", paymentMethod === pm.id ? "border-brand-600 bg-brand-600" : "border-border")}>
                      {paymentMethod === pm.id && <Check className="m-0.5 h-3 w-3 text-white" />}
                    </div>
                  </button>
                ))}
              </div>

              {isManualPayment && (
                <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-5 dark:border-brand-900 dark:bg-brand-950/30">
                  <p className="text-sm font-semibold">Pay {formatBDT(total)} via {paymentMethod === "BKASH" ? "bKash" : "Nagad"} “Send Money”</p>
                  <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <li>1. Open your {paymentMethod === "BKASH" ? "bKash" : "Nagad"} app and choose <span className="font-medium text-foreground">Send Money</span></li>
                    <li>
                      2. Send <span className="font-semibold text-foreground">{formatBDT(total)}</span> to{" "}
                      <span className="font-mono font-semibold text-foreground">{manualNumber}</span>
                    </li>
                    <li>3. Enter the transaction ID (TrxID) from the confirmation SMS below</li>
                  </ol>
                  <div className="mt-4">
                    <Label htmlFor="trxId">Transaction ID (TrxID) *</Label>
                    <Input
                      id="trxId"
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                      placeholder="e.g. 9F7HD2K1LM"
                      className="font-mono"
                    />
                    {trxId.length > 0 && !trxValid && (
                      <p className="mt-1 text-xs text-destructive">Enter the TrxID from your payment SMS (6–40 letters/digits)</p>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Your order ships as soon as our team verifies the payment (usually within minutes during business hours).
                  </p>
                </div>
              )}

              <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <p>
                  Your payment is processed securely. With cash on delivery you pay the courier when
                  your order arrives — inspect first, pay after.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to shipping
                </Button>
                <Button size="lg" className="rounded-xl" onClick={() => setStep(3)} disabled={isManualPayment && !trxValid}>
                  Review Order <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </section>
          )}

          {/* STEP 3 — Review */}
          {step === 3 && (
            <section className="space-y-6" aria-label="Order review">
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-brand-600" /> Deliver to</p>
                    <p className="mt-2 text-sm">{address.fullName} · {address.phone}</p>
                    <p className="text-sm text-muted-foreground">
                      {address.line1}{address.area && `, ${address.area}`}, {address.city}{address.postalCode && ` - ${address.postalCode}`}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Edit</Button>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-brand-600" /> Payment</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {paymentOptions.find((p) => p.id === paymentMethod)?.label}
                    {isManualPayment && trxId && <span className="font-mono"> · TrxID {trxId.trim()}</span>}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="text-sm font-semibold">{cart.count()} item(s) in your order</p>
                <div className="mt-4 space-y-3">
                  {cart.items.map((item) => (
                    <div key={`${item.productId}-${item.variantId ?? "base"}`} className="flex items-center gap-3">
                      <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-muted/40">
                        {item.imageUrl && <Image src={item.imageUrl} alt={item.name} fill sizes="56px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Qty {item.quantity}{item.variantLabel ? ` · ${item.variantLabel}` : ""}
                        </p>
                      </div>
                      <p className="text-sm font-semibold">{formatBDT(item.unitPrice * item.quantity)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {cartErrors.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <p className="font-semibold">Please resolve these issues:</p>
                  {cartErrors.map((e, i) => <p key={i}>• {e}</p>)}
                </div>
              )}

              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to payment
                </Button>
                <Button size="lg" className="rounded-xl px-8" onClick={placeOrder} disabled={placing || cartErrors.length > 0}>
                  {placing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                  Place Order · {formatBDT(total)}
                </Button>
              </div>
            </section>
          )}
        </div>

        {/* Order summary */}
        <aside className="lg:sticky lg:top-36 lg:h-fit" aria-label="Order summary">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-bold">Summary</h2>
            <div className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal ({cart.count()} items)</span>
                <span className="font-medium">{formatBDT(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount {appliedCoupon ? `(${appliedCoupon})` : ""}</span>
                  <span className="font-medium">−{formatBDT(discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                {shippingTotal === 0 ? (
                  <span className="font-medium text-emerald-600">FREE</span>
                ) : (
                  <span className="font-medium">{formatBDT(shippingTotal)}</span>
                )}
              </div>
              {codCharge > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">COD handling charge</span>
                  <span className="font-medium">{formatBDT(codCharge)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-3 text-base font-extrabold">
                <span>Total</span>
                <span>{settings ? formatBDT(total) : <Skeleton className="h-6 w-20" />}</span>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2.5 rounded-xl bg-muted/50 p-3.5 text-xs text-muted-foreground">
              <Truck className="h-4 w-4 shrink-0 text-brand-600" />
              Estimated delivery: {settings?.shipping.estimatedDaysMin ?? 2}–{settings?.shipping.estimatedDaysMax ?? 5} business days
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <>
      {/* InitiateCheckout fires when the page opens with items in cart */}
      <InitiateCheckoutTracker />
      <Suspense fallback={
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
          <Skeleton className="h-9 w-48" />
          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <Skeleton className="h-96 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      }>
        <CheckoutInner />
      </Suspense>
    </>
  );
}

function InitiateCheckoutTracker() {
  const cart = useCart();
  useEffect(() => {
    if (cart.items.length > 0) {
      track("InitiateCheckout", {
        value: cart.subtotal(),
        quantity: cart.count(),
      });
    }
     
  }, []);
  return null;
}

