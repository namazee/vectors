"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { RuntimeSettings } from "@/lib/settings";

export function SettingsForm({ settings }: { settings: RuntimeSettings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  const num = (k: keyof RuntimeSettings) => ({
    value: String(s[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) }),
    type: "number",
    min: 0,
  });

  async function save() {
    setSaving(true);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spend_cap_usd: s.spendCapUsd,
        unmetered_cap_free: s.unmeteredCapFree,
        unmetered_cap_pro: s.unmeteredCapPro,
        free_endpoint_per_minute: s.freeEndpointPerMinute,
        free_endpoint_per_day: s.freeEndpointPerDay,
        frontier_paused: s.frontierManuallyPaused,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Settings saved. They apply within 30 seconds.");
      router.refresh();
    } else toast.error((await res.json().catch(() => null))?.error?.message ?? "Couldn't save settings.");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cap">Monthly spend cap (USD)</Label>
          <Input id="cap" step="10" {...num("spendCapUsd")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fuf">Unmetered fair use / day (Free)</Label>
          <Input id="fuf" {...num("unmeteredCapFree")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fup">Unmetered fair use / day (Pro)</Label>
          <Input id="fup" {...num("unmeteredCapPro")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fem">Free endpoint limit / minute</Label>
          <Input id="fem" {...num("freeEndpointPerMinute")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fed">Free endpoint limit / day</Label>
          <Input id="fed" {...num("freeEndpointPerDay")} />
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Switch
            id="pause"
            checked={s.frontierManuallyPaused}
            onCheckedChange={(v) => setS({ ...s, frontierManuallyPaused: v })}
          />
          <Label htmlFor="pause">Pause frontier models now</Label>
        </div>
      </div>
      <Button onClick={save} disabled={saving}>
        Save settings
      </Button>
    </div>
  );
}
