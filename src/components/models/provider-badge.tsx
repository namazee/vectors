import { cn } from "@/lib/utils";

/** Provider monogram. We use neutral wordmarks rather than third-party logos. */
const COLORS: Record<string, string> = {
  OpenAI: "bg-emerald-600",
  Anthropic: "bg-orange-600",
  Google: "bg-blue-600",
  Meta: "bg-sky-600",
  Alibaba: "bg-violet-600",
  Moonshot: "bg-slate-700",
  "Z.ai": "bg-indigo-600",
  DeepSeek: "bg-blue-800",
  MiniMax: "bg-rose-600",
  Mistral: "bg-amber-600",
  NVIDIA: "bg-lime-700",
  xAI: "bg-zinc-800",
};

export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const initials = provider.replace(/[^A-Za-z]/g, "").slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white",
        COLORS[provider] ?? "bg-muted-foreground",
        className,
      )}
    >
      {initials.charAt(0).toUpperCase() + initials.charAt(1).toLowerCase()}
    </span>
  );
}
