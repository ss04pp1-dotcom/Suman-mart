import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { apiGet, type AccountOverview } from "@/lib/backend-proxy";
import { AccountNav } from "@/components/shop/account-nav";
import { Package } from "lucide-react";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const cookieHeader = (await headers()).get("cookie");
  const data = await apiGet<AccountOverview>("/storefront/account/overview", cookieHeader);
  if (!data) redirect("/login?next=/account");
  const customer = data.customer;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-8 lg:flex-row">
        <aside className="lg:w-64 lg:shrink-0" aria-label="Account navigation">
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full gradient-brand text-sm font-bold text-white">
              {customer.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{customer.name}</p>
              <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
            </div>
          </div>
          <AccountNav />
          <Link
            href="/"
            className="mt-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <Package className="h-4 w-4" /> Continue shopping
          </Link>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
