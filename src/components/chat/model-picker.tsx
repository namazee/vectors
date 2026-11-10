"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, Sparkles, Zap } from "lucide-react";
import { BRAND } from "@/config/plans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderMark } from "@/components/models/provider-badge";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicModel } from "@/lib/types";

export function ModelPicker({
  models,
  value,
  onChange,
  frontierPaused,
  disabled,
  className,
}: {
  models: PublicModel[];
  value: string | null;
  onChange: (slug: string) => void;
  frontierPaused?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = models.find((m) => m.slug === value);

  const groups = useMemo(() => {
    const term = q.toLowerCase();
    const match = (m: PublicModel) => !term || m.name.toLowerCase().includes(term) || m.provider.toLowerCase().includes(term);
    return [
      { tier: "unmetered" as const, label: "Unmetered · 0 credits", icon: Zap, items: models.filter((m) => m.tier === "unmetered" && match(m)) },
      { tier: "frontier" as const, label: `Frontier · uses ${BRAND.creditName}`, icon: Sparkles, items: models.filter((m) => m.tier === "frontier" && match(m)) },
    ];
  }, [models, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} className={cn("max-w-full gap-1.5 px-2 font-medium", className)} aria-label="Choose model">
          {selected ? <ProviderMark provider={selected.provider} className="size-4 text-[8px]" /> : null}
          <span className="truncate">{selected?.name ?? "Choose a model"}</span>
          {selected && (
            <span className="text-xs font-normal text-muted-foreground">
              {selected.tier === "unmetered" ? "free" : `~${formatCredits(selected.creditsPerRequest)}`}
            </span>
          )}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-8 pl-8" autoFocus />
          </div>
        </div>
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-1" role="listbox">
          {groups.map((g) =>
            g.items.length ? (
              <div key={g.tier} className="mb-1">
                <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  <g.icon className="size-3.5" /> {g.label}
                  {g.tier === "frontier" && frontierPaused && <span className="ml-auto text-warning">paused</span>}
                </div>
                {g.items.map((m) => {
                  const off = g.tier === "frontier" && frontierPaused;
                  return (
                    <button
                      key={m.slug}
                      role="option"
                      aria-selected={m.slug === value}
                      disabled={off}
                      onClick={() => {
                        onChange(m.slug);
                        setOpen(false);
                      }}
                      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <ProviderMark provider={m.provider} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{m.name}</span>
                          {m.slug === value && <Check className="size-3.5 text-primary" />}
                        </span>
                        {m.description && <span className="line-clamp-1 text-xs text-muted-foreground">{m.description}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {m.tier === "unmetered" ? "0" : `~${formatCredits(m.creditsPerRequest)}/req`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )}
          {groups.every((g) => !g.items.length) && <p className="p-4 text-center text-sm text-muted-foreground">No models found.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
