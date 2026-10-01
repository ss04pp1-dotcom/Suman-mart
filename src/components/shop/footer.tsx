import Link from "next/link";
import { Package, Phone, Mail, MapPin, Facebook, Instagram, ShieldCheck, Truck, RotateCcw } from "lucide-react";

export function Footer({ storeName, supportPhone, supportEmail, address }: { storeName: string; supportPhone: string; supportEmail: string; address: string }) {
  return (
    <footer className="mt-auto border-t border-border bg-slate-950 text-slate-300">
      {/* Trust strip */}
      <div className="border-b border-slate-800">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 sm:grid-cols-3">
          {[
            { icon: Truck, title: "Fast Delivery", text: "2–5 days nationwide with live tracking" },
            { icon: ShieldCheck, title: "Secure Shopping", text: "Safe checkout with cash on delivery" },
            { icon: RotateCcw, title: "Easy Returns", text: "7-day hassle-free return policy" },
          ].map((f) => (
            <div key={f.title} className="flex items-center gap-4">
              <div className="rounded-2xl bg-slate-900 p-3 text-emerald-400">
                <f.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold text-white">{f.title}</p>
                <p className="text-sm text-slate-400">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand text-white">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-lg font-extrabold text-white">{storeName}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Everything you love, delivered to your nest. Curated products, honest prices and fast
            delivery across Bangladesh.
          </p>
          <div className="mt-5 flex gap-3">
            <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook" className="rounded-full bg-slate-900 p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white">
              <Facebook className="h-4 w-4" />
            </a>
            <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram" className="rounded-full bg-slate-900 p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white">
              <Instagram className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Shop</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/products" className="hover:text-white">All Products</Link></li>
            <li><Link href="/products?category=electronics" className="hover:text-white">Electronics</Link></li>
            <li><Link href="/products?category=fashion" className="hover:text-white">Fashion</Link></li>
            <li><Link href="/products?category=home-living" className="hover:text-white">Home &amp; Living</Link></li>
            <li><Link href="/products?category=groceries" className="hover:text-white">Groceries</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Account</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/account" className="hover:text-white">My Account</Link></li>
            <li><Link href="/account/orders" className="hover:text-white">Order History</Link></li>
            <li><Link href="/wishlist" className="hover:text-white">Wishlist</Link></li>
            <li><Link href="/track-order" className="hover:text-white">Track Order</Link></li>
            <li><Link href="/login" className="hover:text-white">Sign In</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Support</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex items-center gap-2.5">
              <Phone className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-slate-400">{supportPhone}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Mail className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-slate-400">{supportEmail}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-slate-400">{address}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} {storeName}. All rights reserved.</p>
          <p>Cash on Delivery · bKash · Nagad — coming soon</p>
        </div>
      </div>
    </footer>
  );
}
