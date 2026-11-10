"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BRAND } from "@/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCredits, formatUsd } from "@/lib/format";

export interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  plan: "free" | "pro";
  created_at: string;
  daily_balance: number;
  daily_date: string | null;
  topup_balance: number;
  requests_30d: number;
  cost_usd_30d: number;
  credits_30d: number;
  total_count: number;
}

export function UsersTable({ rows, q, page, pages }: { rows: AdminUserRow[]; q: string; page: number; pages: number }) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [adjusting, setAdjusting] = useState<AdminUserRow | null>(null);
  const [amount, setAmount] = useState("");
  const [bucket, setBucket] = useState<"daily" | "topup">("topup");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitAdjust() {
    if (!adjusting) return;
    setBusy(true);
    const res = await fetch(`/api/admin/users/${adjusting.id}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), bucket, note }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(json?.error?.message ?? "Adjustment failed");
    toast.success(`Applied ${formatCredits(json.applied)} ${BRAND.creditName} to ${adjusting.email}`);
    setAdjusting(null);
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/users?q=${encodeURIComponent(search)}`);
        }}
      >
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name" aria-label="Search users" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Daily left</TableHead>
              <TableHead className="text-right">Top-up</TableHead>
              <TableHead className="text-right">Req. 30d</TableHead>
              <TableHead className="text-right">Credits 30d</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="max-w-60 truncate font-medium">{u.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.display_name} · joined {new Date(u.created_at).toLocaleDateString("en-MY")}
                    {u.role === "admin" && <Badge className="ml-1">admin</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.plan === "pro" ? "default" : "secondary"}>{u.plan}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCredits(u.daily_balance)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCredits(u.topup_balance)}</TableCell>
                <TableCell className="text-right tabular-nums">{u.requests_30d}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCredits(u.credits_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(Number(u.cost_usd_30d), 4)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setAdjusting(u)}>
                    Adjust
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={`/admin/users?q=${encodeURIComponent(q)}&page=${page - 1}`} aria-disabled={page <= 1}>
              Previous
            </Link>
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= pages}>
            <Link href={`/admin/users?q=${encodeURIComponent(q)}&page=${page + 1}`} aria-disabled={page >= pages}>
              Next
            </Link>
          </Button>
        </div>
      )}

      <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust credits</DialogTitle>
            <DialogDescription>
              {adjusting?.email}: daily {formatCredits(adjusting?.daily_balance)}, top-up {formatCredits(adjusting?.topup_balance)}. Recorded as
              an <code>admin_adjust</code> ledger entry. Negative amounts deduct (never below zero).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500 or -50" />
            </div>
            <div className="space-y-1.5">
              <Label>Bucket</Label>
              <Select value={bucket} onValueChange={(v) => setBucket(v as "daily" | "topup")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="topup">Top-up (never expires)</SelectItem>
                  <SelectItem value="daily">Today&apos;s allowance (expires at midnight)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="note">Reason</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Goodwill credit for outage" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button onClick={submitAdjust} disabled={busy || !Number(amount) || note.trim().length < 3}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
