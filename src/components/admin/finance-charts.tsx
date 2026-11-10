"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, gridProps, legendProps, SERIES, tooltipProps } from "@/components/charts/chart-kit";

export function DailySpendChart({ data }: { data: { day: string; frontier: number; unmetered: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">No paid usage in the last 30 days.</p>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
          <YAxis {...axisProps} width={60} tickFormatter={(v: number) => `$${v.toFixed(v === 0 ? 0 : v < 0.01 ? 4 : v < 1 ? 2 : 0)}`} />
          <Tooltip {...tooltipProps} formatter={(v) => `$${Number(v).toFixed(4)}`} />
          <Legend {...legendProps} />
          <Bar dataKey="frontier" name="Frontier" stackId="s" fill={SERIES[0]} stroke="var(--card)" strokeWidth={1} />
          <Bar dataKey="unmetered" name="Unmetered fallback" stackId="s" fill={SERIES[1]} stroke="var(--card)" strokeWidth={1} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
