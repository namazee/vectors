import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { loadConversation } from "@/lib/chat/conversations";
import { ChatView, rowsToUiMessages } from "@/components/chat/chat-view";
import { Button } from "@/components/ui/button";
import { getPlan } from "@/config/plans";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { userId, profile } = await requireUser();
  const res = await loadConversation(userId, profile.plan, id);
  if (!res.ok && res.reason === "not_found") notFound();
  if (!res.ok) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <Lock className="size-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold">This chat is in your archive</h1>
        <p className="text-sm text-muted-foreground">
          The Free plan shows your latest {getPlan("free").historyConversationLimit} conversations. Upgrade to Pro for
          unlimited history. Nothing has been deleted.
        </p>
        <Button asChild>
          <Link href="/app/settings?upgrade=pro">Upgrade to Pro</Link>
        </Button>
      </div>
    );
  }
  if (res.conversation.is_compare) {
    redirect(`/app/compare?c=${id}`);
  }
  return (
    <ChatView
      key={id}
      conversationId={id}
      initialMessages={rowsToUiMessages(res.messages)}
      initialModel={res.conversation.model_slug}
    />
  );
}
