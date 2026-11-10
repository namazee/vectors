"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ShieldAlert, Sparkles, Zap } from "lucide-react";
import { BRAND } from "@/config/plans";
import { useAppData } from "@/components/app/app-data";
import { ChatMessage, messageText } from "@/components/chat/chat-message";
import { Composer } from "@/components/chat/composer";
import { ChatError } from "@/components/chat/chat-error";
import { ModelPicker } from "@/components/chat/model-picker";
import { parseChatError, type ChatUIMessage } from "@/lib/chat/types";
import { formatCredits } from "@/lib/format";
import type { MessageRow } from "@/lib/types";

const MODEL_KEY = "vectors:model";

export function rowsToUiMessages(rows: MessageRow[]): ChatUIMessage[] {
  return rows
    .filter((r) => r.role !== "system")
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: r.content }],
      metadata:
        r.role === "assistant"
          ? {
              modelSlug: r.model_slug ?? undefined,
              servedModel: r.served_model ?? undefined,
              credits: Number(r.credits_used ?? 0),
              status: r.status,
              notice: r.notice ?? undefined,
              createdAt: r.created_at,
            }
          : undefined,
    }));
}

export function useSelectedModel(initial?: string | null) {
  const { models } = useAppData();
  const [model, setModelState] = useState<string | null>(initial ?? null);
  useEffect(() => {
    if (!models.length) return;
    if (model && models.some((m) => m.slug === model)) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MODEL_KEY);
    } catch {
      /* storage unavailable */
    }
    const pick = models.find((m) => m.slug === saved) ?? models.find((m) => m.tier === "unmetered") ?? models[0];
    setModelState(pick.slug);
  }, [models, model]);
  const setModel = useCallback((slug: string) => {
    setModelState(slug);
    try {
      localStorage.setItem(MODEL_KEY, slug);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return [model, setModel] as const;
}

export function ChatView({
  conversationId,
  initialMessages,
  initialModel,
}: {
  conversationId: string | null;
  initialMessages: ChatUIMessage[];
  initialModel?: string | null;
}) {
  const { models, status: appStatus, setWallet, upsertConversation, refreshConversations, refreshMe } = useAppData();
  const [model, setModel] = useSelectedModel(initialModel);
  const [input, setInput] = useState("");
  const convRef = useRef<string | null>(conversationId);
  const modelRef = useRef<string | null>(model);
  modelRef.current = model;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const last = messages[messages.length - 1];
          return {
            body: {
              conversationId: convRef.current,
              model: modelRef.current,
              trigger: trigger === "regenerate-message" ? "regenerate" : "submit",
              text: trigger === "submit-message" && last ? messageText(last) : undefined,
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, regenerate, stop, status, error, clearError } = useChat<ChatUIMessage>({
    id: conversationId ?? undefined,
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === "data-conversation") {
        convRef.current = part.data.id;
        window.history.replaceState(null, "", `/app/c/${part.data.id}`);
        const now = new Date().toISOString();
        upsertConversation({ id: part.data.id, title: part.data.title, model_slug: modelRef.current, is_compare: false, created_at: now, updated_at: now });
      } else if (part.type === "data-wallet") {
        setWallet(part.data);
      }
    },
    onFinish: () => {
      refreshConversations();
      refreshMe();
    },
    onError: () => {
      refreshMe();
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const selected = models.find((m) => m.slug === model);
  const modelNames = useMemo(() => Object.fromEntries(models.map((m) => [m.slug, m.name])), [models]);
  const parsedError = error ? parseChatError(error) : null;

  // Auto-scroll while streaming if the user is near the bottom.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function submit() {
    const text = input.trim();
    if (!text || !model) return;
    clearError();
    setInput("");
    stick.current = true;
    sendMessage({ text });
  }

  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
  const unmetered = selected?.tier === "unmetered";

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 ? (
          <EmptyState onPick={(t) => setInput(t)} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                message={m}
                streaming={busy && i === messages.length - 1 && m.role === "assistant"}
                canRegenerate={!busy && i === lastAssistantIdx && i === messages.length - 1}
                onRegenerate={() => {
                  clearError();
                  regenerate();
                }}
                modelNames={modelNames}
              />
            ))}
            {status === "submitted" && messages[messages.length - 1]?.role === "user" && (
              <ChatMessage
                message={{ id: "pending", role: "assistant", parts: [], metadata: { modelSlug: model ?? undefined } }}
                streaming
                modelNames={modelNames}
              />
            )}
            {parsedError && (
              <ChatError
                error={parsedError}
                onRetry={() => {
                  clearError();
                  regenerate();
                }}
                onUseUnmetered={() => {
                  const free = models.find((m) => m.tier === "unmetered");
                  if (free) setModel(free.slug);
                  clearError();
                }}
              />
            )}
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onStop={() => stop()}
        busy={busy}
        disabled={!model}
        placeholder={selected ? `Message ${selected.name}` : "Message…"}
        toolbar={
          <ModelPicker models={models} value={model} onChange={setModel} frontierPaused={appStatus?.frontierPaused} />
        }
        footer={
          unmetered ? (
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="size-3" /> Free model endpoints may log prompts. Don&apos;t share sensitive info.{" "}
              <Link href="/privacy#free-models" className="underline">
                Learn more
              </Link>
            </span>
          ) : selected ? (
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3" /> ~{formatCredits(selected.creditsPerRequest)} {BRAND.creditName} per request, charged on
              actual usage.
            </span>
          ) : null
        }
      />
    </div>
  );
}

const SUGGESTIONS = [
  "Explain quantum computing like I'm 12",
  "Write a polite email asking my landlord to fix the aircon",
  "Plan a 3-day trip to Penang on a budget",
  "Review this TypeScript function for bugs",
];

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  const { models } = useAppData();
  const free = models.filter((m) => m.tier === "unmetered").length;
  const frontier = models.filter((m) => m.tier === "frontier").length;
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What can I help with?</h1>
        <p className="text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Zap className="size-3.5 text-success" /> {free} free models
          </span>{" "}
          ·{" "}
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5 text-primary" /> {frontier} frontier models
          </span>
        </p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
