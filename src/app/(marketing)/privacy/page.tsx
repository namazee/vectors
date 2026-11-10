import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BRAND } from "@/config/plans";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="10 November 2026">
      <h2>What we collect</h2>
      <ul>
        <li>Account data: email address, display name, and profile picture if you sign in with Google.</li>
        <li>Your conversations, so you can see your chat history.</li>
        <li>Usage data: which models you use, token counts, credits spent and timestamps.</li>
        <li>Billing data is handled by Stripe. We never see or store your full card number.</li>
      </ul>

      <h2 id="free-models">Free (unmetered) model endpoints may log your prompts</h2>
      <p>
        {BRAND.appName} sends your messages to AI providers through OpenRouter. Some <strong>free model endpoints</strong>{" "}
        are offered by providers who may <strong>log, store and use prompts and responses</strong>, including to train
        their models. Unmetered models in {BRAND.appName} show a notice in the chat when this applies.
      </p>
      <p>
        <strong>Do not send personal, confidential or sensitive information to unmetered models.</strong> For sensitive
        work, use a frontier (paid) model. Paid endpoints are generally subject to stricter provider data policies, but
        each provider&apos;s own terms apply.
      </p>

      <h2>How we use your data</h2>
      <ul>
        <li>To provide the service: routing your messages, saving history, and charging credits.</li>
        <li>To prevent abuse and enforce fair-use limits.</li>
        <li>To bill you and comply with legal obligations.</li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2>Retention and deletion</h2>
      <p>
        You can delete individual conversations at any time, or delete your whole account from Settings. Deleting your
        account removes your profile, conversations and messages. We may keep billing records as required by law.
      </p>

      <h2>Contact</h2>
      <p>Questions about privacy: {BRAND.supportEmail}</p>
    </LegalPage>
  );
}
