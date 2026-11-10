import Link from "next/link";
import { ArrowRight, Columns3, History, Layers, LockKeyhole, Sparkles, Wallet, Zap } from "lucide-react";
import { BRAND, PLANS } from "@/config/plans";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ProviderMark } from "@/components/models/provider-badge";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { getPublicModels } from "@/lib/models/catalog";
import { formatMyr } from "@/lib/format";

export const revalidate = 600;

const FEATURES = [
  { icon: Layers, title: "Every major model", body: "GPT, Claude, Gemini, Grok, Qwen, Kimi, GLM, DeepSeek, Llama and more, all in one chat." },
  { icon: Zap, title: "Free models included", body: "Fast open models cost 0 credits. Use them all day under a fair-use limit." },
  { icon: Wallet, title: "Pay for what you use", body: `Frontier models are charged in ${BRAND.creditName} based on real usage. No surprise bills.` },
  { icon: History, title: "Saved history", body: "Every conversation is saved and searchable. Switch models mid-chat without losing context." },
  { icon: Columns3, title: "Compare side by side", body: "Pro: send one prompt to up to 3 models and pick the best answer." },
  { icon: LockKeyhole, title: "One login, one bill", body: `Pay in ringgit. One subscription instead of five. Pro is ${formatMyr(PLANS.pro.priceMyr, 0)}/month.` },
];

const FAQ = [
  {
    q: `What are ${BRAND.creditName}?`,
    a: `${BRAND.creditName} are the credits you spend on frontier models. Each request is charged by how much text goes in and out, so short questions cost less. You get a free allowance every day that resets at midnight Malaysia time.`,
  },
  {
    q: "Are the unmetered models really free?",
    a: "Yes. Unmetered models cost 0 credits on every plan. There's a daily fair-use limit to keep things fast for everyone. If a free endpoint is busy we automatically route you to a backup so your chat keeps working.",
  },
  {
    q: "What do I get with Pro?",
    a: `A much larger daily ${BRAND.creditName} allowance (${PLANS.pro.dailyCredits}/day vs ${PLANS.free.dailyCredits}/day), priority routing to faster providers, unlimited chat history and side-by-side model comparison.`,
  },
  {
    q: "Do unused credits roll over?",
    a: `Your daily allowance doesn't roll over. ${BRAND.creditName} you buy in top-up packs never expire, and they're only used after your daily allowance runs out.`,
  },
  {
    q: "Is my data private?",
    a: "Your chats are private to your account. Note that some free model endpoints may log prompts for training. We show a notice on those models. Don't share sensitive information with unmetered models.",
  },
  {
    q: "How do I pay? Can I cancel?",
    a: "Pay by card in MYR via Stripe (top-ups also accept FPX and GrabPay). Cancel Pro anytime from Settings. You keep Pro until the end of the billing period.",
  },
];

export default async function LandingPage() {
  const models = await getPublicModels();
  const providers = Array.from(new Set(models.map((m) => m.provider)));

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]" />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pt-20 pb-16 text-center sm:pt-28">
          <Badge variant="outline" className="gap-1.5 px-3 py-1">
            <Sparkles className="size-3.5 text-primary" /> {models.length}+ models · priced in ringgit
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">{BRAND.tagline}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground text-balance">
            One login, one chat, every leading AI. Use fast open models for free and switch to GPT, Claude or Gemini
            when you need the best, paying only for what you use.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start chatting free <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">No card required · {PLANS.free.dailyCredits} free {BRAND.creditName} every day</p>
        </div>
      </section>

      <section id="models" className="border-y bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <p className="mb-6 text-center text-sm text-muted-foreground">Models from the world&apos;s leading AI labs</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            {providers.map((p) => (
              <span key={p} className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ProviderMark provider={p} className="size-6" /> {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Stop juggling AI subscriptions</h2>
          <p className="mt-3 text-muted-foreground">
            Every lab ships a new best model every few months. With {BRAND.appName} you always have it, without another
            monthly fee.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="mb-4 size-6 text-primary" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="border-t bg-muted/20">
        <div className="mx-auto max-w-5xl px-4 py-20">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Simple, fair pricing</h2>
            <p className="mt-3 text-muted-foreground">Free models for everyone. Frontier models with credits.</p>
          </div>
          <PricingCards models={models} showTopups={false} />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
        <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">Frequently asked questions</h2>
        <Accordion type="single" collapsible>
          {FAQ.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-base">{f.q}</AccordionTrigger>
              <AccordionContent>{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="border-t">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-4 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance">Your AI toolbox, in one tab.</h2>
          <p className="text-muted-foreground">Create a free account in under a minute.</p>
          <Button asChild size="lg">
            <Link href="/signup">
              Get started free <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
