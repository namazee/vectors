import { BRAND, CREDITS, CURRENCY } from "@/config/plans";

export function formatCredits(n: number | string | null | undefined, decimals: number = CREDITS.displayDecimals): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString("en-US");
  return Number(v.toFixed(decimals)).toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function creditsLabel(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `${formatCredits(v)} ${v === 1 ? BRAND.creditNameSingular : BRAND.creditName}`;
}

export function formatMyr(n: number, decimals = 2): string {
  return `${CURRENCY.symbol} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatUsd(n: number, decimals = 2): string {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatPct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}
