"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Client-side so marketing pages stay static. Reads the local session only (no network). */
export function AuthButtons() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    createClient()
      .auth.getSession()
      .then(({ data }) => setSignedIn(!!data.session))
      .catch(() => {});
  }, []);

  if (signedIn) {
    return (
      <Button asChild size="sm">
        <Link href="/app">Open app</Link>
      </Button>
    );
  }
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
        <Link href="/login">Log in</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/signup">Get started</Link>
      </Button>
    </>
  );
}
