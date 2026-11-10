import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { getPublicModels } from "@/lib/models/catalog";
import { BRAND } from "@/config/plans";

export const metadata: Metadata = { title: "Pricing" };
export const revalidate = 600;

export default async function PricingPage() {
  const models = await getPublicModels();
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Unmetered models are free on every account. Frontier models use {BRAND.creditName}, and you get a fresh
          allowance every day.
        </p>
      </div>
      <PricingCards models={models} />
    </div>
  );
}
