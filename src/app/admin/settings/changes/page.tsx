import Link from "next/link";

import { SettingsHeader } from "@/components/admin/settings-header";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import {
  SETTINGS_CHANGE_TYPES,
  type SettingsChangeType,
  listSettingsHistory,
} from "@/lib/admin/payment-settings";
import { formatDateTime } from "@/lib/dates";

export const generateMetadata = staffTitle("Recent changes", Permission.SETTINGS_EDIT);

const TABS = [{ slug: "all", label: "All" }, ...SETTINGS_CHANGE_TYPES] as const;
const LABELS = new Map<string, string>(
  SETTINGS_CHANGE_TYPES.map((type) => [type.slug, type.label]),
);

export default async function SettingsChangesPage({
  searchParams,
}: PageProps<"/admin/settings/changes">) {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings/changes");

  // Anything unknown is All, like the other admin tabs.
  const { type: raw } = await searchParams;
  const type = SETTINGS_CHANGE_TYPES.find((option) => option.slug === raw)?.slug as
    SettingsChangeType | undefined;
  const history = await listSettingsHistory({ type, limit: 50 });

  return (
    <main className="mx-auto w-full max-w-5xl">
      <SettingsHeader title="Recent changes">
        Who changed the shop&apos;s settings, and what they changed.
      </SettingsHeader>

      <nav aria-label="Which settings" className="mt-6">
        {/* Shared out across the width on a phone, so all four fit. */}
        <ul className="flex gap-1 rounded-xl border border-border bg-surface-muted/50 p-1 sm:inline-flex">
          {TABS.map((tab) => {
            const active = (type ?? "all") === tab.slug;

            return (
              <li key={tab.slug} className="flex-1 sm:flex-none">
                <Link
                  href={
                    tab.slug === "all"
                      ? "/admin/settings/changes"
                      : `/admin/settings/changes?type=${tab.slug}`
                  }
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-2 py-2 text-center text-[13px] transition sm:px-4 sm:text-sm ${
                    active
                      ? "bg-surface font-medium text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {history.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {type ? `No changes to ${LABELS.get(type)?.toLowerCase()} yet.` : "No changes yet."}
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {history.map((change) => (
            <li key={change.id} className="p-4 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{change.actor}</span>
                <span className="text-muted">· {formatDateTime(change.createdAt)}</span>
                {!type && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                    {LABELS.get(change.type)}
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {change.changes.map((line) => (
                  <li key={line} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
