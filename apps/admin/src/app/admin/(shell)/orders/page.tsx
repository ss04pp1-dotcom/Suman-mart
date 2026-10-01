"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Filter, PackageSearch, RotateCcw, Search } from "lucide-react";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/status-badge";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatBDT, formatDateTime, ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  customer: { id: string; name: string; email: string } | null;
  items: { id: string; name: string; quantity: number }[];
  supplierOrders: { id: string; status: string; supplier: { id: string; name: string } }[];
}

export default function AdminOrdersPage() {
  const [filters, setFilters] = useState({ q: "", status: "", paymentStatus: "", supplier: "", from: "", to: "", page: 1 });

  const queryString = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, String(v)));
    params.set("limit", "15");
    return params.toString();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", filters],
    queryFn: async () => {
      const res = await fetch(`/api/admin/orders?${queryString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { items: OrderRow[]; total: number; page: number; totalPages: number; suppliers: { id: string; name: string }[] };
    },
  });

  const setFilter = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value, page: key === "page" ? Number(value) : 1 }));

  const resetFilters = () => setFilters({ q: "", status: "", paymentStatus: "", supplier: "", from: "", to: "", page: 1 });

  const activeFilters = [filters.q, filters.status, filters.paymentStatus, filters.supplier, filters.from, filters.to].filter(Boolean).length;

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        description={`${data?.total ?? "…"} orders in total`}
        actions={
          <Button variant="outline" className="rounded-xl bg-card" asChild>
            <a href={`/api/admin/reports/export?type=orders&range=30d${filters.from ? `&from=${filters.from}` : ""}${filters.to ? `&to=${filters.to}` : ""}`}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </a>
          </Button>
        }
      />

      {/* Filter bar */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
              placeholder="Search order number, customer or phone…"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.status || "all_status"} onValueChange={(v) => setFilter("status", v === "all_status" ? "" : v)}>
              <SelectTrigger className="h-10 w-[150px] rounded-xl" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_status">All statuses</SelectItem>
                {ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.paymentStatus || "all_pay"} onValueChange={(v) => setFilter("paymentStatus", v === "all_pay" ? "" : v)}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl" aria-label="Payment status"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_pay">All payments</SelectItem>
                {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.supplier || "all_sup"} onValueChange={(v) => setFilter("supplier", v === "all_sup" ? "" : v)}>
              <SelectTrigger className="h-10 w-[170px] rounded-xl" aria-label="Supplier"><SelectValue placeholder="Supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_sup">All suppliers</SelectItem>
                {(data?.suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className="h-10 w-[140px] rounded-xl" aria-label="From date" />
            <Input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className="h-10 w-[140px] rounded-xl" aria-label="To date" />
            {activeFilters > 0 && (
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={resetFilters} aria-label="Reset filters">
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table / cards */}
      {isLoading ? (
        <Card><CardContent className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        </CardContent></Card>
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState
          icon={activeFilters > 0 ? Filter : PackageSearch}
          title="No orders found"
          description={activeFilters > 0 ? "Try adjusting or resetting the filters." : "Orders will appear here once customers start purchasing."}
          action={activeFilters > 0 ? <Button variant="outline" onClick={resetFilters}>Reset filters</Button> : undefined}
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="max-w-[240px]">Products</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((order) => (
                    <TableRow key={order.id} className="group">
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-mono text-sm font-bold text-brand-700 hover:underline dark:text-brand-600">
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{order.customerName}</p>
                        <p className="text-xs text-muted-foreground">{order.customerPhone}</p>
                      </TableCell>
                      <TableCell>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {order.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{formatBDT(order.total)}</TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={order.paymentStatus} />
                        <p className="mt-1 text-[10px] uppercase text-muted-foreground">{order.paymentMethod}</p>
                      </TableCell>
                      <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                      <TableCell>
                        {order.supplierOrders.length > 0 ? (
                          <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                            {order.supplierOrders[0].supplier.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">In-house</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {data.items.map((order) => (
              <Link key={order.id} href={`/admin/orders/${order.id}`} className="block">
                <Card><CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">{order.orderNumber}</span>
                    <span className="text-sm font-bold">{formatBDT(order.total)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{order.customerName}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
                    {order.items.map((i) => i.name).join(", ")}
                  </p>
                </CardContent></Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page <= 1} onClick={() => setFilter("page", String(data.page - 1))} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page >= data.totalPages} onClick={() => setFilter("page", String(data.page + 1))} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
