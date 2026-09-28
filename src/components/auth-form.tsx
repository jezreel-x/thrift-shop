"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/actions";

/**
 * The sign-in and sign-up forms, which differ by one field and their wording.
 *
 * A client component only so that `useActionState` can show the server's error
 * without a full reload. The form itself is an ordinary `<form action={...}>`,
 * so it submits and works before any JavaScript arrives — the enhancement is the
 * error message appearing in place, not the ability to sign in.
 */
export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "sign-in" | "sign-up";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignUp = mode === "sign-up";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </p>
      )}

      {isSignUp && (
        <Field
          id="name"
          label="Name"
          hint="Optional — what an order confirmation should call you."
          autoComplete="name"
        />
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        // The first field people touch, and on a phone the keyboard should
        // already be open.
        autoFocus
      />

      <Field
        id="password"
        label="Password"
        type="password"
        // Tells a password manager to offer a new password rather than an
        // existing one, and vice versa.
        autoComplete={isSignUp ? "new-password" : "current-password"}
        hint={isSignUp ? "At least 8 characters. A few words beats a short jumble." : undefined}
        required
        minLength={isSignUp ? 8 : undefined}
      />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Just a moment…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
        {isSignUp ? "Already have an account? " : "New here? "}
        <Link
          // Carries the destination across, so being sent to the wrong form does
          // not lose where the buyer was heading.
          href={`${isSignUp ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(next)}`}
          className="underline underline-offset-4"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {hint}
        </p>
      )}
    </div>
  );
}
