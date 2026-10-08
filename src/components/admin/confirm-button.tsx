"use client";

import { useRef } from "react";

/**
 * A button that posts a small form, after asking.
 *
 * The same layering as Sign out and Remove payment details: a real form, with
 * a confirmation <dialog> in front of it when JavaScript is available. Without
 * script it posts directly, so the button never does nothing.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  title,
  body,
  confirmLabel,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Hidden fields the form posts. */
  fields: Record<string, string>;
  label: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  className: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  return (
    <>
      <form
        ref={form}
        action={action}
        onSubmit={(event) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          event.preventDefault();
          dialog.current?.showModal();
        }}
      >
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button type="submit" className={className}>
          {label}
        </button>
      </form>

      <dialog
        ref={dialog}
        aria-label={title}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              confirmed.current = true;
              dialog.current?.close();
              form.current?.requestSubmit();
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
