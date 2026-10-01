"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";

export const CHART_COLORS = ["#059669", "#0d9488", "#f59e0b", "#e11d48", "#8b5cf6", "#0ea5e9", "#64748b"];

const tooltipStyle = {
  borderRadius: "12px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--card)",
  boxShadow: "0 8px 24px -6px rgb(0 0 0 / 0.15)",
  fontSize: "12px",
} as const;

function shortDate(value: string): string {
  const d = new Date(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ChartCard({
  title,
  description,
  children,
  className,
  loading,
  height = 300,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  height?: number;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton style={{ height }} className="w-full rounded-xl" />
        ) : (
          <div style={{ height }} className="[&_.recharts-surface]:overflow-visible">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Traffic (sessions) + Revenue over time */
export function TrafficRevenueChart({
  data,
  loading,
}: {
  data: { date: string; sessions: number; orders: number; revenue: number }[];
  loading?: boolean;
}) {
  return (
    <ChartCard title="Traffic & Revenue" description="Daily visitors vs order revenue" loading={loading} height={320}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gSessions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis yAxisId="left" tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={40} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `৳${formatCompact(Number(v))}`} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={52} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => new Date(String(l)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
          <Area yAxisId="left" type="monotone" dataKey="sessions" name="Visitors" stroke="#0d9488" strokeWidth={2} fill="url(#gSessions)" />
          <Area yAxisId="right" type="monotone" dataKey="revenue" name="Revenue (৳)" stroke="#059669" strokeWidth={2} fill="url(#gRevenue)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function OrdersChart({
  data,
  loading,
}: {
  data: { date: string; orders: number }[];
  loading?: boolean;
}) {
  return (
    <ChartCard title="Orders Overview" description="Orders per day" loading={loading}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => new Date(String(l)).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />
          <Bar dataKey="orders" name="Orders" fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DonutChart({
  title,
  description,
  data,
  loading,
  valueSuffix = "",
}: {
  title: string;
  description?: string;
  data: { name: string; value: number }[];
  loading?: boolean;
  valueSuffix?: string;
}) {
  return (
    <ChartCard title={title} description={description} loading={loading} height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3} strokeWidth={0}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}${valueSuffix}`} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function HorizontalBarsChart({
  title,
  description,
  data,
  loading,
  color = "#059669",
  valuePrefix = "",
}: {
  title: string;
  description?: string;
  data: { name: string; value: number }[];
  loading?: boolean;
  color?: string;
  valuePrefix?: string;
}) {
  return (
    <ChartCard title={title} description={description} loading={loading} height={Math.max(220, data.length * 44 + 60)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `${valuePrefix}${formatCompact(Number(v))}`} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${valuePrefix}${Number(v).toLocaleString()}`} />
          <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function MiniTrendChart({ data, color = "#059669" }: { data: { date: string; value: number }[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
