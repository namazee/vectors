"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, gridProps, legendProps, SERIES, tooltipProps } from "@/components/charts/chart-kit";
import { formatCredits } from "@/lib/format";

export function UsageChart({ data, series }: { data: Record<string, number | string>[]; series: string[] }) {
  if (!series.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No frontier usage in the last 30 days.</p>;
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={20} />
          <YAxis {...axisProps} width={44} />
          <Tooltip {...tooltipProps} formatter={(v) => formatCredits(Number(v), 2)} />
          <Legend {...legendProps} />
          {series.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              stackId="u"
              // "Other" uses a neutral tone; named models take categorical slots in fixed order.
              fill={s === "Other" ? "var(--muted-foreground)" : SERIES[i]}
              stroke="var(--card)"
              strokeWidth={1}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
