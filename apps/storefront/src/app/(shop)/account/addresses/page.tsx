
import { apiGet, type AccountOverview } from "@/lib/backend-proxy";
import { AddressManager } from "@/components/shop/address-manager";

export default async function AccountAddressesPage() {
  const data = await apiGet<AccountOverview>("/storefront/account/overview");
  if (!data) return null;
  const addresses = data.customer.addresses;

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
