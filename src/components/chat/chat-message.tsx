"use client";

import { Info, RefreshCw, Sparkles } from "lucide-react";
import { BRAND } from "@/config/plans";
import { Markdown, CopyButton } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatUIMessage } from "@/lib/chat/types";

export function messageText(m: ChatUIMessage): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

export function ChatMessage({
  message,
  streaming,
  canRegenerate,
  onRegenerate,
  modelNames,
}: {
  message: ChatUIMessage;
  streaming?: boolean;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  modelNames: Record<string, string>;
}) {
  const text = messageText(message);
  const meta = message.metadata ?? {};

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap break-words">{text}</div>
      </div>
    );
  }

  const modelName = meta.servedModelName ?? (meta.modelSlug ? modelNames[meta.modelSlug] : undefined) ?? meta.modelName;
  return (
    <div className="group space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{modelName ?? "Assistant"}</span>
        {meta.credits != null && meta.credits > 0 && (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" /> {formatCredits(meta.credits, 2)} {BRAND.creditName}
          </span>
        )}
        {meta.status === "stopped" && <span>· stopped</span>}
      </div>
      {meta.notice && (
        <div className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" /> {meta.notice}
        </div>
      )}
      {text ? (
        <Markdown text={text} />
      ) : streaming ? (
        <div className="flex gap-1 py-2" aria-label="Thinking">
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60" />
        </div>
      ) : null}
      {!streaming && text && (
        <div className={cn("flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100", canRegenerate && "md:opacity-100")}>
          <CopyButton text={text} label="Copy reply" />
          {canRegenerate && onRegenerate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Regenerate" onClick={onRegenerate}>
                  <RefreshCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Regenerate with the selected model</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
