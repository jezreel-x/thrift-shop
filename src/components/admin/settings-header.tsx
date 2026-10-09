import { History } from "lucide-react";
import Link from "next/link";

/**
 * The top of each settings page: where you are, what this page is for, and a
 * link to this section's own changes.
 */
export function SettingsHeader({
  title,
  children,
  changes,
}: {
  title: string;
  children: React.ReactNode;
  /** The Recent changes tab for this section. */
  changes?: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-[11px] font-medium tracking-wider text-muted uppercase">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-1 text-sm text-muted">{children}</div>
      </div>
      {changes && (
        <Link
          href={`/admin/settings/changes?type=${changes}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <History aria-hidden className="size-4" />
          Changes
        </Link>
      )}
    </header>
  );
}
