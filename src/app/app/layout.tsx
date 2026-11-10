import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app/app-shell";
import { getPlan } from "@/config/plans";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, email } = await requireUser();
  const plan = getPlan(profile.plan);
  return (
    <AppShell
      user={{
        name: profile.display_name ?? email ?? "You",
        email: email ?? "",
        avatarUrl: profile.avatar_url,
        isAdmin: profile.role === "admin",
        plan: plan.id,
      }}
    >
      {children}
    </AppShell>
  );
}
