"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? "text";
  const code = textOf(children).replace(/\n$/, "");
  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1 text-xs text-zinc-400">
        <span>{lang}</span>
        <div className="[&_button]:text-zinc-300 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <CopyButton text={code} label="Copy code" />
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "") || String(textOf(children)).includes("\n");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
