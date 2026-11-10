"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, SquarePen } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UserMenu, type ShellUser } from "@/components/app/user-menu";
import { ConversationList } from "@/components/app/conversation-list";
import { CreditIndicator } from "@/components/credits/credit-indicator";
import { AppDataProvider, useAppData } from "@/components/app/app-data";

function SidebarBody({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-3">
        <Logo href="/app" />
        <Button asChild variant="ghost" size="icon" aria-label="New chat" onClick={onNavigate}>
          <Link href="/app">
            <SquarePen />
          </Link>
        </Button>
      </div>
      <ConversationList onNavigate={onNavigate} />
      <div className="border-t p-2">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <AppDataProvider plan={user.plan}>
      <ShellFrame user={user}>{children}</ShellFrame>
    </AppDataProvider>
  );
}

function ShellFrame({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { status } = useAppData();
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-72 shrink-0 border-r bg-sidebar md:block">
        <SidebarBody user={user} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SidebarBody user={user} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open sidebar" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <div className="flex-1" />
          <CreditIndicator />
        </header>
        {status?.frontierPaused && (
          <div className="border-b bg-warning/15 px-4 py-2 text-center text-sm">
            Frontier models are taking a short break due to high demand. Unmetered models are still available.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
