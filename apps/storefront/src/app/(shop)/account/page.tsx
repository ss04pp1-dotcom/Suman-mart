import { db } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/auth";
import { formatBDT, formatDate } from "@/lib/format";
import { Package, ShoppingBag, Truck, Wallet } from "lucide-react";

export default async function AccountProfilePage() {
  const customer = await getCurrentCustomer();
  if (!customer) return null;

  const [orderCount, totalSpent, pendingCount, addressCount] = await Promise.all([
    db.order.count({ where: { customerId: customer.id, status: { not: "CANCELLED" } } }),
    db.order.aggregate({ where: { customerId: customer.id, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    db.order.count({ where: { customerId: customer.id, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] } } }),
    db.address.count({ where: { customerId: customer.id } }),
  ]);

  const stats = [
    { icon: ShoppingBag, label: "Total orders", value: String(orderCount) },
    { icon: Wallet, label: "Total spent", value: formatBDT(totalSpent._sum.total ?? 0) },
    { icon: Truck, label: "Active orders", value: String(pendingCount) },
    { icon: Package, label: "Saved addresses", value: String(addressCount) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Member since {formatDate(customer.createdAt)}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <div className="w-fit rounded-xl bg-brand-50 p-2 text-brand-600 dark:bg-brand-100">
              <s.icon className="h-5 w-5" />
            </div>
            <p className="mt-3 text-lg font-extrabold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-bold">Personal information</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            ["Full name", customer.name],
            ["Email", customer.email],
            ["Mobile", customer.phone ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/40 p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          To update your details or password, visit the dedicated sections in the sidebar.
        </p>
      </div>
    </div>
  );
}
