import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BRAND } from "@/config/plans";

export const metadata: Metadata = { title: "Refund policy" };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy" updated="10 November 2026">
      <h2>Failed requests</h2>
      <p>
        If a frontier-model request fails, the {BRAND.creditName} reserved for it are returned to your balance
        automatically. You never pay for a request that didn&apos;t produce a response.
      </p>
      <h2>Pro subscription</h2>
      <p>
        You can cancel at any time. Cancellation stops the next renewal, and you keep Pro until the end of the current
        period. We don&apos;t offer partial refunds for unused days, except where required by law.
      </p>
      <h2>Top-up packs</h2>
      <p>
        Unused top-up packs can be refunded within 14 days of purchase. Contact {BRAND.supportEmail}. Packs that have
        been partly used are not refundable.
      </p>
      <h2>Billing errors</h2>
      <p>If you were charged in error, contact us within 30 days and we will make it right.</p>
    </LegalPage>
  );
}
