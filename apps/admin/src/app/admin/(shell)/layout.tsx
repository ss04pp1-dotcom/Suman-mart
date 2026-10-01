import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { apiGet, type AdminMe } from "@/lib/backend-proxy";
import { AdminShell, AdminQueryProvider } from "@/components/admin/admin-shell";

// Server component: session introspection happens on the Workers API
// (/v1/admin/auth/me verifies the sn_admin JWT against the database — active
// account + tokenVersion). The edge middleware has already cheap-checked the
// JWT locally; this is the authoritative gate.
export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const cookieHeader = (await headers()).get("cookie");
  const me = await apiGet<AdminMe>("/admin/auth/me", cookieHeader);
  const admin = me?.admin ?? null;
  if (!admin) redirect("/admin/login");
  // Seeded / reset accounts must change their password before touching the console
  if (admin.mustChangePassword) redirect("/admin/change-password");

  return (
    <AdminQueryProvider>
      <AdminShell
        admin={{
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          roleLabel: admin.roleLabel || admin.role,
          // Per-admin overrides win; otherwise the role's baseline set.
          permissions: admin.permissionOverrides ?? admin.permissions,
        }}
      >
        {children}
      </AdminShell>
    </AdminQueryProvider>
  );
}
