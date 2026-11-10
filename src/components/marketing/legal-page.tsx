export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="prose-chat mx-auto max-w-3xl px-4 py-16 [&_h2]:mt-8 [&_p]:text-muted-foreground [&_li]:text-muted-foreground">
      <h1 className="!text-3xl !font-bold tracking-tight">{title}</h1>
      <p className="!text-sm">Last updated: {updated}</p>
      <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        Placeholder text. Have this reviewed by a lawyer familiar with Malaysian law (including the PDPA 2010 and the
        Consumer Protection Act 1999) before launch.
      </div>
      {children}
    </article>
  );
}
