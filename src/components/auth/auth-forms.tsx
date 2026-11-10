"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import {
  type AuthState,
  forgotPasswordAction,
  googleSignInAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

function StateAlert({ state }: { state: AuthState }) {
  if (state.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  if (state.message)
    return (
      <Alert>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  return null;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function GoogleButton({ next }: { next?: string }) {
  return (
    <form action={googleSignInAction}>
      <input type="hidden" name="next" value={next ?? "/app"} />
      <Button type="submit" variant="outline" className="w-full">
        <GoogleIcon /> Continue with Google
      </Button>
    </form>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" /> or <Separator className="flex-1" />
    </div>
  );
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action] = useActionState(signInAction, { error: initialError });
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Log in to continue chatting</p>
      </div>
      <GoogleButton next={next} />
      <Divider />
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/app"} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <StateAlert state={state} />
        <Submit>Log in</Submit>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign up free
        </Link>
      </p>
    </div>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUpAction, {});
  if (state.message) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button asChild variant="outline">
          <Link href="/login">Back to login</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Free forever. No card required.</p>
      </div>
      <GoogleButton next={next} />
      <Divider />
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/app"} />
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        <StateAlert state={state} />
        <Submit>Create account</Submit>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        By signing up you agree to our <Link href="/terms" className="underline">Terms</Link> and{" "}
        <Link href="/privacy" className="underline">Privacy policy</Link>.
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, {});
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll email you a link to set a new password.</p>
      </div>
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <StateAlert state={state} />
        <Submit>Send reset link</Submit>
      </form>
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground">
          Back to login
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, {});
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      </div>
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <StateAlert state={state} />
        <Submit>Update password</Submit>
      </form>
    </div>
  );
}
