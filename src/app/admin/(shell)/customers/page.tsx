"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, RotateCcw, Search, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatBDT, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CustomerRow {
  id: string; name: string; email: string; phone: string; createdAt: string;
  isActive: boolean; totalOrders: number; totalSpent: number; lastOrderAt: string | null;
}

export default function CustomersPage() {
  const [filters, setFilters] = useState({ q: "", page: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customers", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      params.set("page", String(filters.page));
      params.set("limit", "15");
      const res = await fetch(`/api/admin/customers?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { items: CustomerRow[]; total: number; page: number; totalPages: number };
    },
  });

  return (
    <div>
      <AdminPageHeader
        title="Customers"
        description={`${data?.total ?? "…"} registered customers`}
        actions={
          <Button variant="outline" className="rounded-xl bg-card" asChild>
            <a href="/api/admin/reports/export?type=customers&range=30d"><Download className="mr-2 h-4 w-4" /> Export</a>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value, page: 1 })}
              placeholder="Search by name, email or phone…"
              className="h-10 rounded-xl pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </CardContent></Card>
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState icon={Users} title="No customers found" />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Total Spent</TableHead>
                      <TableHead>Last Order</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/admin/customers/${c.id}`} className="flex items-center gap-3 group">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-brand text-xs font-bold text-white">
                              {c.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                            </span>
                            <div>
                              <p className="text-sm font-semibold group-hover:text-brand-600">{c.name}</p>
                              <p className="text-xs text-muted-foreground">{c.email}</p>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{c.totalOrders}</TableCell>
                        <TableCell className="text-right text-sm font-bold">{formatBDT(c.totalSpent)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.lastOrderAt ? formatDate(c.lastOrderAt) : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className={c.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                            {c.isActive ? "Active" : "Blocked"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {data.items.map((c) => (
                  <Link key={c.id} href={`/admin/customers/${c.id}`} className="block p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full gradient-brand text-xs font-bold text-white">
                          {c.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </span>
                        <div>
                          <p className="text-sm font-semibold">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatBDT(c.totalSpent)}</p>
                        <p className="text-xs text-muted-foreground">{c.totalOrders} orders</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page >= data.totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
