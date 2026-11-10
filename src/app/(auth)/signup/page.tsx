import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string; next?: string }> }) {
  const { plan, next } = await searchParams;
  return <SignupForm next={next ?? (plan === "pro" ? "/app/settings?upgrade=pro" : "/app")} />;
}
