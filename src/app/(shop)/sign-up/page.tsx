import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/lib/auth/actions";
import { getCurrentUser, safeReturnTo } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  const returnTo = safeReturnTo(typeof next === "string" ? next : undefined);

  if (await getCurrentUser()) redirect(returnTo);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mt-2 mb-8 text-sm text-neutral-600 dark:text-neutral-400">
        Stock is one of one, so an account is how a piece stays yours while you pay.
      </p>

      <AuthForm mode="sign-up" action={signUpAction} next={returnTo} />
    </main>
  );
}
