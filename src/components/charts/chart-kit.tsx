"use client";

/** Shared Recharts styling: recessive grid/axes, themed tooltip, categorical slots in fixed order. */
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

export const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: "var(--border)", strokeDasharray: "0", vertical: false } as const;

export const tooltipProps = {
  cursor: { fill: "var(--muted)", opacity: 0.5 },
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 4 },
  itemStyle: { color: "var(--popover-foreground)", padding: 0 },
} as const;

export const legendProps = {
  iconType: "circle" as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: "var(--muted-foreground)" },
};
