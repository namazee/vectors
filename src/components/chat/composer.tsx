"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder = "Message…",
  toolbar,
  footer,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <form
        className={cn(
          "rounded-2xl border bg-background shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/30",
          disabled && "opacity-70",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && value.trim()) onSubmit();
        }}
      >
        <textarea
          ref={ref}
          value={value}
          rows={1}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy && value.trim()) onSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
          {busy ? (
            <Button type="button" size="icon" variant="secondary" className="rounded-full" onClick={onStop} aria-label="Stop generating">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="rounded-full" disabled={!value.trim() || disabled} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
      {footer && <div className="mt-1.5 px-2 text-center text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
