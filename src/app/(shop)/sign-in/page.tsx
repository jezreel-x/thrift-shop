import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { signInAction } from "@/lib/auth/actions";
import { getCurrentUser, safeReturnTo } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Sign in",
  // Nothing here should ever appear in a search result.
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const returnTo = safeReturnTo(typeof next === "string" ? next : undefined);

  // Somebody already signed in has nothing to do here, and landing on a sign-in
  // form when you are signed in reads like the session was lost.
  if (await getCurrentUser()) redirect(returnTo);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 mb-8 text-sm text-neutral-600 dark:text-neutral-400">
        Sign in to reserve a piece and check out.
      </p>

      <AuthForm mode="sign-in" action={signInAction} next={returnTo} />
    </main>
  );
}
