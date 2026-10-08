"use client";

import { startTransition, useActionState, useId, useState } from "react";

import { type GrantFormState, grantRoleAction } from "@/lib/admin/staff-actions";

/**
 * Gives someone a role, by the email they signed up with.
 *
 * Submitted by hand rather than through `action` when script is available:
 * React resets a form after its action runs, and a refused grant would clear
 * the email the owner just typed.
 */
export function GrantRoleForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<GrantFormState, FormData>(
    grantRoleAction,
    {},
  );
  const emailId = useId();
  // A fresh email box after each successful grant; kept after a refusal.
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.granted) setRound((current) => current + 1);
  }
  const roleId = useId();

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor={emailId} className="text-sm font-medium">
            Their email
          </label>
          <input
            key={round}
            id={emailId}
            name="email"
            type="email"
            autoComplete="off"
            placeholder="amina@example.com"
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-medium">
            Role
          </label>
          <select
            key={round}
            id={roleId}
            name="roleId"
            defaultValue=""
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            {/* No role chosen until someone picks one: never Owner by accident. */}
            <option value="" disabled>
              Choose a role…
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : state.granted ? (
        <p role="status" className="mt-3 text-sm text-green-800 dark:text-green-300">
          Done. {state.granted} has the role from their next click.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted">
          They need an account on the shop first: ask them to sign up, then add them here.
        </p>
      )}
    </form>
  );
}
