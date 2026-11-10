import { createAdminClient } from "@/lib/supabase/admin";
import { UsersTable, type AdminUserRow } from "@/components/admin/users-table";

export const dynamic = "force-dynamic";

const PAGE = 50;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const { data, error } = await createAdminClient().rpc("admin_list_users", {
    p_search: q || null,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
  });
  const rows = (data ?? []) as AdminUserRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Sorted by 30-day OpenRouter cost. {total} user(s).</p>
      </div>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <UsersTable rows={rows} q={q} page={page} pages={Math.max(1, Math.ceil(total / PAGE))} />
    </div>
  );
}
