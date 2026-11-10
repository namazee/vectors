import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BRAND } from "@/config/plans";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="10 November 2026">
      <h2>1. The service</h2>
      <p>
        {BRAND.appName} gives you access to third-party AI models through one interface. AI output can be wrong, and you
        are responsible for how you use it.
      </p>
      <h2>2. Accounts</h2>
      <p>You must provide accurate information and keep your login secure. One person per account.</p>
      <h2>3. Credits ({BRAND.creditName})</h2>
      <ul>
        <li>{BRAND.creditName} have no cash value and cannot be transferred or exchanged.</li>
        <li>The daily allowance resets at 00:00 Malaysia time and does not roll over.</li>
        <li>Purchased top-up {BRAND.creditName} do not expire while your account is active.</li>
        <li>Credit costs per model may change as provider prices change.</li>
      </ul>
      <h2>4. Fair use</h2>
      <p>
        Unmetered models are subject to daily fair-use limits. We may limit or suspend accounts that abuse the service,
        for example through automated scraping or reselling access.
      </p>
      <h2>5. Acceptable use</h2>
      <p>No illegal content, harassment, malware, or attempts to bypass limits or security.</p>
      <h2>6. Subscriptions</h2>
      <p>Pro renews monthly until cancelled. Cancel anytime in Settings; access continues until the period ends.</p>
      <h2>7. Liability</h2>
      <p>The service is provided &quot;as is&quot; to the extent permitted by Malaysian law.</p>
      <h2>8. Contact</h2>
      <p>{BRAND.supportEmail}</p>
    </LegalPage>
  );
}
