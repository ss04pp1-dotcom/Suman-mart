import { db } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/auth";
import { AddressManager } from "@/components/shop/address-manager";

export default async function AccountAddressesPage() {
  const customer = await getCurrentCustomer();
  if (!customer) return null;

  const addresses = await db.address.findMany({
    where: { customerId: customer.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Saved Addresses</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage delivery addresses for faster checkout.</p>
      </div>
      <AddressManager
        initialAddresses={JSON.parse(JSON.stringify(addresses))}
      />
    </div>
  );
}
