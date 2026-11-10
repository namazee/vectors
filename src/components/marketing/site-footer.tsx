import Link from "next/link";
import { Logo } from "@/components/logo";
import { BRAND } from "@/config/plans";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div className="space-y-2">
          <Logo />
          <p className="text-muted-foreground">{BRAND.tagline}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-medium">Product</span>
          <Link href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
          <Link href="/#models" className="text-muted-foreground hover:text-foreground">Models</Link>
          <Link href="/#faq" className="text-muted-foreground hover:text-foreground">FAQ</Link>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-medium">Legal</span>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms of service</Link>
          <Link href="/refund-policy" className="text-muted-foreground hover:text-foreground">Refund policy</Link>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {BRAND.company}. Prices in MYR.
      </div>
    </footer>
  );
}
