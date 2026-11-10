import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Logo href="/admin" />
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Admin</span>
          <div className="flex-1" />
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">
              <ArrowLeft /> Back to app
            </Link>
          </Button>
          <ThemeToggle />
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
