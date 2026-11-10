"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/app/app-data";
import { ChatMessage } from "@/components/chat/chat-message";
import { ChatError } from "@/components/chat/chat-error";
import { Composer } from "@/components/chat/composer";
import { ModelPicker } from "@/components/chat/model-picker";
import { Button } from "@/components/ui/button";
import { parseChatError, type ChatUIMessage } from "@/lib/chat/types";
import { formatCredits } from "@/lib/format";
import { rowsToUiMessages } from "@/components/chat/chat-view";
import type { Conversation, MessageRow } from "@/lib/types";

interface ColumnHandle {
  send: (text: string) => void;
  stop: () => void;
  busy: () => boolean;
}

interface ColumnProps {
  model: string;
  onModelChange: (slug: string) => void;
  locked: boolean;
  initialMessages: ChatUIMessage[];
  convRef: React.RefObject<string | null>;
  groupRef: React.RefObject<string | null>;
  onBusyChange: (busy: boolean) => void;
}

const CompareColumn = forwardRef<ColumnHandle, ColumnProps>(function CompareColumn(
  { model, onModelChange, locked, initialMessages, convRef, groupRef, onBusyChange },
  ref,
) {
  const { models, status: appStatus, setWallet, refreshMe } = useAppData();
  const modelRef = useRef(model);
  modelRef.current = model;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: () => ({
          body: { conversationId: convRef.current, model: modelRef.current, trigger: "compare", compareGroup: groupRef.current },
        }),
      }),
    [convRef, groupRef],
  );
  const chat = useChat<ChatUIMessage>({
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === "data-wallet") setWallet(part.data);
    },
    onFinish: () => refreshMe(),
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const busyCb = useRef(onBusyChange);
  busyCb.current = onBusyChange;
  useEffect(() => busyCb.current(busy), [busy]);
  useImperativeHandle(ref, () => ({
    send: (text: string) => {
      chat.clearError();
      chat.sendMessage({ text });
    },
    stop: () => chat.stop(),
    busy: () => busy,
  }));

  const names = useMemo(() => Object.fromEntries(models.map((m) => [m.slug, m.name])), [models]);
  const selected = models.find((m) => m.slug === model);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  const credits = chat.messages.reduce((s, m) => s + (m.metadata?.credits ?? 0), 0);
  const error = chat.error ? parseChatError(chat.error) : null;

  return (
    <div className="flex min-h-0 min-w-[280px] flex-1 flex-col border-r last:border-r-0">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <ModelPicker models={models} value={model} onChange={onModelChange} disabled={locked} frontierPaused={appStatus?.frontierPaused} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {selected?.tier === "unmetered" ? "free" : `${formatCredits(credits, 2)} used`}
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 text-sm">
        {chat.messages.map((m, idx) => (
          <ChatMessage
            key={m.id}
            message={m}
            modelNames={names}
            streaming={busy && idx === chat.messages.length - 1 && m.role === "assistant"}
          />
        ))}
        {chat.status === "submitted" && (
          <ChatMessage message={{ id: "p", role: "assistant", parts: [], metadata: { modelSlug: model } }} streaming modelNames={names} />
        )}
        {error && <ChatError error={error} />}
      </div>
    </div>
  );
});

function groupInitial(rows: MessageRow[], slugs: string[]) {
  return slugs.map((slug) => rowsToUiMessages(rows.filter((r) => r.role === "user" || r.model_slug === slug)));
}

export function CompareView({
  initial,
  maxModels,
}: {
  initial: { conversation: Conversation; messages: MessageRow[] } | null;
  maxModels: number;
}) {
  const { models, upsertConversation, refreshConversations } = useAppData();
  const initialSlugs = useMemo(() => {
    if (!initial) return [];
    const seen: string[] = [];
    for (const m of initial.messages) if (m.role === "assistant" && m.model_slug && !seen.includes(m.model_slug)) seen.push(m.model_slug);
    return seen.slice(0, maxModels);
  }, [initial, maxModels]);
  const [slugs, setSlugs] = useState<string[]>(initialSlugs);
  const [input, setInput] = useState("");
  const [busyCols, setBusyCols] = useState<boolean[]>([]);
  const convRef = useRef<string | null>(initial?.conversation.id ?? null);
  const groupRef = useRef<string | null>(null);
  const cols = useRef<(ColumnHandle | null)[]>([]);
  const locked = !!initial?.messages.length || !!convRef.current;
  const initialPerColumn = useMemo(() => (initial ? groupInitial(initial.messages, initialSlugs) : []), [initial, initialSlugs]);

  // Default picks: two frontier models (or whatever is available).
  useEffect(() => {
    if (slugs.length || !models.length) return;
    const frontier = models.filter((m) => m.tier === "frontier");
    const pool = frontier.length >= 2 ? frontier : models;
    setSlugs(pool.slice(0, 2).map((m) => m.slug));
  }, [models, slugs.length]);

  const busy = busyCols.slice(0, slugs.length).some(Boolean);

  async function submit() {
    const text = input.trim();
    if (!text || slugs.length < 2) return;
    try {
      if (!convRef.current) {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: text.slice(0, 60), isCompare: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Couldn't start the comparison.");
        convRef.current = json.conversation.id;
        upsertConversation(json.conversation);
        window.history.replaceState(null, "", `/app/compare?c=${json.conversation.id}`);
      }
      const group = crypto.randomUUID();
      groupRef.current = group;
      const res = await fetch(`/api/conversations/${convRef.current}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, compareGroup: group }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Couldn't send.");
      setInput("");
      cols.current.slice(0, slugs.length).forEach((c) => c?.send(text));
      setTimeout(refreshConversations, 1500);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          Comparing {slugs.length} models{locked ? "" : `. Pick up to ${maxModels}.`}
        </span>
        {!locked && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={slugs.length <= 2}
              onClick={() => setSlugs((s) => s.slice(0, -1))}
              aria-label="Remove a model"
            >
              <Minus />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={slugs.length >= maxModels}
              onClick={() => setSlugs((s) => [...s, models.find((m) => !s.includes(m.slug))?.slug ?? models[0].slug])}
              aria-label="Add a model"
            >
              <Plus />
            </Button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {slugs.map((slug, idx) => (
          <CompareColumn
            key={idx}
            ref={(h) => {
              cols.current[idx] = h;
            }}
            model={slug}
            locked={locked}
            onModelChange={(v) => setSlugs((s) => s.map((x, j) => (j === idx ? v : x)))}
            initialMessages={initialPerColumn[idx] ?? []}
            convRef={convRef}
            groupRef={groupRef}
            onBusyChange={(b) =>
              setBusyCols((prev) => {
                const next = [...prev];
                next[idx] = b;
                return next;
              })
            }
          />
        ))}
      </div>
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onStop={() => cols.current.forEach((c) => c?.stop())}
        busy={busy}
        disabled={slugs.length < 2}
        placeholder={`Ask ${slugs.length} models at once…`}
        footer="Each model is charged separately. Unmetered models stay free."
      />
    </div>
  );
}
