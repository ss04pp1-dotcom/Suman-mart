import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { ROLE_LABELS, ROLE_PERMISSIONS, type AdminRole } from "@/lib/permissions";
import { parseJSON } from "@/lib/json";
import { AdminShell, AdminQueryProvider } from "@/components/admin/admin-shell";

export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // Seeded / reset accounts must change their password before touching the console
  if (admin.mustChangePassword) redirect("/admin/change-password");

  const overrides = parseJSON<string[] | null>(admin.permissions, null);
  const rolePerms = ROLE_PERMISSIONS[admin.role as AdminRole] ?? [];

  return (
    <AdminQueryProvider>
      <AdminShell
        admin={{
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          roleLabel: ROLE_LABELS[admin.role as AdminRole] ?? admin.role,
          permissions: overrides ?? rolePerms,
        }}
      >
        {children}
      </AdminShell>
    </AdminQueryProvider>
  );
}
