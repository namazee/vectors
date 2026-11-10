"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProviderMark } from "@/components/models/provider-badge";
import { displayCreditsPerRequest } from "@/lib/credits/pricing";
import { formatCredits } from "@/lib/format";
import type { ModelRow } from "@/lib/types";

async function patchModel(id: string, patch: Partial<ModelRow>) {
  const res = await fetch("/api/admin/models", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, patch }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
  return json.model as ModelRow;
}

export function ModelsManager({ initial }: { initial: ModelRow[] }) {
  const [models, setModels] = useState(() => [...initial].sort((a, b) => a.tier.localeCompare(b.tier) || a.sort_order - b.sort_order));
  const [editing, setEditing] = useState<ModelRow | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function update(m: ModelRow, patch: Partial<ModelRow>) {
    try {
      const updated = await patchModel(m.id, patch);
      setModels((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
      toast.success(`${m.display_name} updated`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function move(tier: ModelRow["tier"], index: number, dir: -1 | 1) {
    const group = models.filter((m) => m.tier === tier);
    const j = index + dir;
    if (j < 0 || j >= group.length) return;
    [group[index], group[j]] = [group[j], group[index]];
    // Full order: unmetered first, then frontier. The server assigns sort_order 10, 20, 30…
    const ordered = [
      ...(tier === "unmetered" ? group : models.filter((m) => m.tier === "unmetered")),
      ...(tier === "frontier" ? group : models.filter((m) => m.tier === "frontier")),
    ].map((m, i) => ({ ...m, sort_order: (i + 1) * 10 }));
    setModels(ordered);
    const res = await fetch("/api/admin/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ordered.map((m) => m.id) }),
    });
    if (!res.ok) toast.error("Couldn't save order.");
  }

  async function sync(dry: boolean) {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/models${dry ? "?dry=1" : ""}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Sync failed");
      const msg = `${json.changes.length} price change(s)${json.missing.length ? `, ${json.missing.length} model(s) missing on OpenRouter` : ""}`;
      if (dry) toast.info(`Preview: ${msg}`);
      else {
        toast.success(`Synced: ${msg}`);
        window.location.reload();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSyncing(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => sync(true)} disabled={syncing}>
          Preview price sync
        </Button>
        <Button onClick={() => sync(false)} disabled={syncing}>
          <RefreshCw className={syncing ? "animate-spin" : ""} /> Sync prices from OpenRouter
        </Button>
      </div>

      {(["unmetered", "frontier"] as const).map((tier) => {
        const group = models.filter((m) => m.tier === tier);
        return (
          <section key={tier} className="space-y-2">
            <h2 className="font-semibold capitalize">
              {tier} <span className="text-sm font-normal text-muted-foreground">({group.length})</span>
            </h2>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Order</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>OpenRouter ID</TableHead>
                    <TableHead className="text-right">$/1M in · out</TableHead>
                    <TableHead className="text-right">~Credits/req</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((m, i) => (
                    <TableRow key={m.id} className={m.active ? "" : "opacity-60"}>
                      <TableCell>
                        <div className="flex">
                          <Button variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => move(tier, i, -1)} disabled={i === 0}>
                            <ArrowUp />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => move(tier, i, 1)} disabled={i === group.length - 1}>
                            <ArrowDown />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProviderMark provider={m.provider} />
                          <span className="font-medium">{m.display_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.openrouter_id}
                        {m.free_openrouter_id && <Badge variant="success" className="ml-2">:free</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(m.input_price_per_m).toFixed(3)} · {Number(m.output_price_per_m).toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tier === "unmetered" ? "0" : formatCredits(displayCreditsPerRequest(m), 2)}
                        {tier === "frontier" && m.avg_sample_count > 0 && (
                          <div className="text-xs text-muted-foreground">avg of {m.avg_sample_count}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch checked={m.active} onCheckedChange={(v) => update(m, { active: v })} aria-label={`Toggle ${m.display_name}`} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.display_name}`} onClick={() => setEditing(m)}>
                          <Pencil />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      {editing && (
        <EditDialog
          model={editing}
          all={models}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await update(editing, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  model,
  all,
  onClose,
  onSave,
}: {
  model: ModelRow;
  all: ModelRow[];
  onClose: () => void;
  onSave: (patch: Partial<ModelRow>) => Promise<void>;
}) {
  const [f, setF] = useState({
    display_name: model.display_name,
    description: model.description ?? "",
    tier: model.tier,
    openrouter_id: model.openrouter_id,
    free_openrouter_id: model.free_openrouter_id ?? "",
    fallback_model_slug: model.fallback_model_slug ?? "",
    input_price_per_m: String(model.input_price_per_m),
    output_price_per_m: String(model.output_price_per_m),
    est_credits_per_request: model.est_credits_per_request == null ? "" : String(model.est_credits_per_request),
    margin_override: model.margin_override == null ? "" : String(model.margin_override),
    max_output_tokens: model.max_output_tokens == null ? "" : String(model.max_output_tokens),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const optNum = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {model.display_name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Display name</Label>
            <Input value={f.display_name} onChange={set("display_name")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <Input value={f.description} onChange={set("description")} />
          </div>
          <div className="space-y-1.5">
            <Label>Tier</Label>
            <Select value={f.tier} onValueChange={(v) => setF({ ...f, tier: v as ModelRow["tier"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unmetered">Unmetered (0 credits)</SelectItem>
                <SelectItem value="frontier">Frontier (credits)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Max output tokens</Label>
            <Input type="number" value={f.max_output_tokens} onChange={set("max_output_tokens")} placeholder="default" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>OpenRouter ID (paid)</Label>
            <Input className="font-mono" value={f.openrouter_id} onChange={set("openrouter_id")} />
          </div>
          {f.tier === "unmetered" && (
            <>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Free endpoint ID (optional)</Label>
                <Input className="font-mono" value={f.free_openrouter_id} onChange={set("free_openrouter_id")} placeholder="vendor/model:free" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Fallback unmetered model</Label>
                <Select value={f.fallback_model_slug || "none"} onValueChange={(v) => setF({ ...f, fallback_model_slug: v === "none" ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {all
                      .filter((m) => m.tier === "unmetered" && m.slug !== model.slug)
                      .map((m) => (
                        <SelectItem key={m.slug} value={m.slug}>
                          {m.display_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Input $ / 1M tokens</Label>
            <Input type="number" step="0.001" value={f.input_price_per_m} onChange={set("input_price_per_m")} />
          </div>
          <div className="space-y-1.5">
            <Label>Output $ / 1M tokens</Label>
            <Input type="number" step="0.001" value={f.output_price_per_m} onChange={set("output_price_per_m")} />
          </div>
          {f.tier === "frontier" && (
            <>
              <div className="space-y-1.5">
                <Label>Seed estimate (credits/request)</Label>
                <Input type="number" step="0.1" value={f.est_credits_per_request} onChange={set("est_credits_per_request")} placeholder="auto" />
              </div>
              <div className="space-y-1.5">
                <Label>Margin override (×)</Label>
                <Input type="number" step="0.05" value={f.margin_override} onChange={set("margin_override")} placeholder="global" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                display_name: f.display_name,
                description: f.description || null,
                tier: f.tier,
                openrouter_id: f.openrouter_id,
                free_openrouter_id: f.free_openrouter_id || null,
                fallback_model_slug: f.fallback_model_slug || null,
                input_price_per_m: Number(f.input_price_per_m),
                output_price_per_m: Number(f.output_price_per_m),
                est_credits_per_request: optNum(f.est_credits_per_request),
                margin_override: optNum(f.margin_override),
                max_output_tokens: optNum(f.max_output_tokens),
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
