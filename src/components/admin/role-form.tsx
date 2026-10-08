"use client";

import { startTransition, useActionState, useState } from "react";

import type { Permission } from "@/generated/prisma/enums";
import { PERMISSION_GROUPS } from "@/lib/admin/permissions";
import { type RoleFormState, saveRoleAction } from "@/lib/admin/staff-actions";

const INPUT =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none";

/**
 * A role: its name, what it is for, and what it may do, grouped as the
 * permissions are described in permissions.ts.
 *
 * Checkboxes in a real form, so it works without script. With script it
 * submits by hand: React resets a form after its action runs, and a refused
 * save would untick every box the owner had just ticked.
 */
export function RoleForm({
  role,
}: {
  role: { id: string; name: string; description: string; permissions: Permission[] } | null;
}) {
  const [state, formAction, saving] = useActionState<RoleFormState, FormData>(saveRoleAction, {});
  // Fields edited since the last save attempt: their errors are out of date.
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setEdited(new Set());
  }
  const errors = Object.fromEntries(
    Object.entries(state.errors ?? {}).filter(([field]) => !edited.has(field)),
  ) as NonNullable<RoleFormState["errors"]>;
  const held = new Set(role?.permissions ?? []);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      onChange={(event) => {
        const { target } = event;
        const name = "name" in target && typeof target.name === "string" ? target.name : "";
        if (name && !edited.has(name)) setEdited(new Set(edited).add(name));
      }}
      className="flex max-w-3xl flex-col gap-6"
    >
      {role && <input type="hidden" name="roleId" value={role.id} />}

      {errors.form && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {errors.form}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            defaultValue={role?.name}
            maxLength={40}
            placeholder="Cashier"
            className={`${INPUT} ${errors.name ? "border-red-400" : "border-border"}`}
          />
          {errors.name && <p className="text-xs text-red-700 dark:text-red-300">{errors.name}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm font-medium">
            What it&apos;s for
          </label>
          <input
            id="description"
            name="description"
            defaultValue={role?.description}
            maxLength={200}
            placeholder="Optional. Confirms payments at the till."
            className={`${INPUT} ${errors.description ? "border-red-400" : "border-border"}`}
          />
          {errors.description && (
            <p className="text-xs text-red-700 dark:text-red-300">{errors.description}</p>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">What this role may do</legend>
        {errors.permissions && (
          <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
            {errors.permissions}
          </p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.area} className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
                {group.area}
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                {group.permissions.map((info) => (
                  <li key={info.permission}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        name="permissions"
                        value={info.permission}
                        defaultChecked={held.has(info.permission)}
                        className="mt-0.5 size-4"
                      />
                      <span>
                        <span className="block text-sm font-medium">{info.label}</span>
                        <span className="block text-xs text-muted">{info.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : role ? "Save role" : "Create role"}
        </button>
      </div>
    </form>
  );
}
