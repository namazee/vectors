"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Columns3, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/app/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

function groupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations, conversationsLoaded, search, setSearch, upsertConversation, removeConversation, status } =
    useAppData();
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [title, setTitle] = useState("");

  async function rename() {
    if (!renaming) return;
    const res = await fetch(`/api/conversations/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      upsertConversation({ ...renaming, title });
      setRenaming(null);
    } else toast.error("Couldn't rename the chat.");
  }

  async function remove() {
    if (!deleting) return;
    const res = await fetch(`/api/conversations/${deleting.id}`, { method: "DELETE" });
    if (res.ok) {
      removeConversation(deleting.id);
      if (params.id === deleting.id) router.push("/app");
      setDeleting(null);
    } else toast.error("Couldn't delete the chat.");
  }

  const groups: { label: string; items: Conversation[] }[] = [];
  for (const c of conversations) {
    const label = groupLabel(c.updated_at);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(c);
    else groups.push({ label, items: [c] });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3 pb-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            className="h-8 pl-8"
            aria-label="Search chats"
          />
        </div>
        {status?.compareEnabled !== undefined && (
          <Button asChild variant="ghost" size="sm" className="w-full justify-start" onClick={onNavigate}>
            <Link href="/app/compare">
              <Columns3 /> Compare models
              {!status.compareEnabled && <span className="ml-auto text-xs text-muted-foreground">Pro</span>}
            </Link>
          </Button>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversations">
        {!conversationsLoaded &&
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mx-1 my-1.5 h-7" />)}
        {conversationsLoaded && conversations.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {search ? "No chats match your search." : "No chats yet. Say hello!"}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{g.label}</div>
            {g.items.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center rounded-md text-sm hover:bg-accent",
                  params.id === c.id && "bg-accent font-medium",
                )}
              >
                <Link
                  href={c.is_compare ? `/app/compare?c=${c.id}` : `/app/c/${c.id}`}
                  onClick={onNavigate}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                >
                  {c.is_compare && <Columns3 className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{c.title}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mr-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label={`Options for ${c.title}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setTitle(c.title);
                        setRenaming(c);
                      }}
                    >
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleting?.title}&rdquo; and all its messages will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
