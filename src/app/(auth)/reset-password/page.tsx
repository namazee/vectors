import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { getOptionalSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  // The recovery link signs the user in via /auth/callback first.
  const session = await getOptionalSession();
  if (!session) redirect("/forgot-password");
  return <ResetPasswordForm />;
}
