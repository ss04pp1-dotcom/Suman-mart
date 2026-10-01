"use client";

import { CalendarRange } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom Range" },
];

export function DateRangeFilter({
  range,
  from,
  to,
  onChange,
}: {
  range: string;
  from?: string;
  to?: string;
  onChange: (next: { range: string; from?: string; to?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Select value={range} onValueChange={(v) => onChange({ range: v, from, to })}>
          <SelectTrigger className="h-10 w-[160px] rounded-xl bg-card pl-9" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {range === "custom" && (
        <div className="flex items-center gap-2">
          <div>
            <Label htmlFor="range-from" className="sr-only">From</Label>
            <Input id="range-from" type="date" value={from ?? ""} onChange={(e) => onChange({ range, from: e.target.value, to })} className="h-10 w-[150px] rounded-xl bg-card" />
          </div>
          <span className="text-muted-foreground">–</span>
          <div>
            <Label htmlFor="range-to" className="sr-only">To</Label>
            <Input id="range-to" type="date" value={to ?? ""} onChange={(e) => onChange({ range, from, to: e.target.value })} className="h-10 w-[150px] rounded-xl bg-card" />
          </div>
        </div>
      )}
    </div>
  );
}
