"use client";

import { useActionState, useState } from "react";

import type { PaymentSettingsFormValues } from "@/lib/admin/payment-settings";
import {
  type PaymentSettingsFormState,
  savePaymentSettingsAction,
} from "@/lib/admin/settings-actions";

/** Matches PaymentMethod. POCHI covers any Send Money number, Pochi or personal. */
type Method = "TILL" | "PAYBILL" | "POCHI";

const METHODS: { value: Method; label: string; hint: string }[] = [
  { value: "TILL", label: "Till", hint: "Buy Goods and Services" },
  { value: "PAYBILL", label: "Paybill", hint: "Business number and account" },
  { value: "POCHI", label: "Send Money", hint: "To a phone number: Pochi or personal" },
];

const NAME_HINTS: Record<Method, string> = {
  TILL: "The business name registered to the till, exactly as M-Pesa shows it (usually in capitals).",
  PAYBILL:
    "The name M-Pesa shows for this paybill. For a bank paybill, that may be the bank's name.",
  POCHI:
    "The name registered to this phone number, exactly as M-Pesa shows it to someone sending money.",
};

/**
 * Where buyers send money, with a preview of the checkout box they will see.
 *
 * Inputs are controlled only to drive the preview. The form itself is an
 * ordinary one: it posts and saves without JavaScript, and the paybill account
 * field appears through CSS (:has) rather than script.
 */
export function PaymentSettingsForm({
  initial,
  instructions,
  numberLabels,
}: {
  initial: PaymentSettingsFormValues;
  instructions: Record<Method, string>;
  numberLabels: Record<Method, string>;
}) {
  const [state, formAction, saving] = useActionState<PaymentSettingsFormState, FormData>(
    savePaymentSettingsAction,
    {},
  );
  const [values, setValues] = useState(initial);
  const set =
    (field: keyof PaymentSettingsFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }));

  const method = (values.method || null) as Method | null;
  const errors = state.errors ?? {};

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <form action={formAction} className="group flex min-w-0 flex-col gap-6" noValidate>
        {state.saved && (
          <p
            role="status"
            className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          >
            {state.saved === "changed"
              ? "Saved. Checkout shows the new details from now on."
              : "Nothing changed: these are already the saved details."}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium">How do buyers pay?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {METHODS.map((option) => (
              <label
                key={option.value}
                className="cursor-pointer rounded-xl border border-border p-3 transition has-checked:border-foreground has-checked:bg-surface-muted has-focus-visible:ring-2 has-focus-visible:ring-foreground"
              >
                <input
                  type="radio"
                  name="method"
                  id={`method-${option.value}`}
                  value={option.value}
                  checked={values.method === option.value}
                  onChange={set("method")}
                  className="sr-only"
                />
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </label>
            ))}
          </div>
          <FieldError message={errors.method} />
          {method === "POCHI" && (
            <p className="mt-2 text-xs text-muted">
              Pochi la Biashara keeps sales in their own wallet, apart from personal money, which
              makes payments much easier to check. A personal line works too.
            </p>
          )}
        </fieldset>

        <Field
          id="number"
          label={method ? numberLabels[method] : "Till, paybill or phone number"}
          error={errors.number}
        >
          <input
            id="number"
            name="number"
            value={values.number}
            onChange={set("number")}
            inputMode={method === "POCHI" ? "tel" : "numeric"}
            autoComplete="off"
            className={inputClass(errors.number)}
          />
        </Field>

        {/* Shown only for a paybill, by CSS, so it works before any script runs. */}
        <div className="hidden group-has-[#method-PAYBILL:checked]:block">
          <Field
            id="accountNumber"
            label="Account number"
            hint="What buyers type in the account field."
            error={errors.accountNumber}
          >
            <input
              id="accountNumber"
              name="accountNumber"
              value={values.accountNumber}
              onChange={set("accountNumber")}
              autoComplete="off"
              className={inputClass(errors.accountNumber)}
            />
          </Field>
        </div>

        <Field
          id="name"
          label="Name M-Pesa shows buyers"
          hint={
            method
              ? NAME_HINTS[method]
              : "Exactly as M-Pesa shows it before the buyer enters their PIN."
          }
          error={errors.name}
        >
          <input
            id="name"
            name="name"
            value={values.name}
            onChange={set("name")}
            autoComplete="off"
            className={inputClass(errors.name)}
          />
        </Field>

        <Field
          id="note"
          label="Note for buyers (optional)"
          hint="Shown under the payment details, e.g. when you confirm payments."
          error={errors.note}
        >
          <textarea
            id="note"
            name="note"
            rows={2}
            value={values.note}
            onChange={set("note")}
            className={inputClass(errors.note)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {saving ? "Saving…" : "Save payment details"}
          </button>
          <p className="text-xs text-muted">
            Buyers pay whatever is saved here. Check the number against your M-Pesa before saving.
          </p>
        </div>
      </form>

      <aside aria-label="Checkout preview">
        <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
          What buyers see at checkout
        </p>
        <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm">
          {method ? (
            <>
              <p className="text-muted">{instructions[method]}</p>
              <dl className="mt-3 space-y-2">
                <PreviewRow label={numberLabels[method]} value={values.number} />
                {method === "PAYBILL" && (
                  <PreviewRow label="Account number" value={values.accountNumber} />
                )}
                <PreviewRow label="M-Pesa will show" value={values.name} />
              </dl>
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Before you enter your PIN, M-Pesa shows the name you are paying. If it is not{" "}
                <span className="font-semibold">{values.name || "…"}</span>, stop and contact us.
              </p>
              {values.note && <p className="mt-2 text-muted">{values.note}</p>}
            </>
          ) : (
            <p className="text-muted">
              Not set up yet. Until it is, checkout tells buyers payment details are coming rather
              than showing a number.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
      {message}
    </p>
  ) : null;
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono font-semibold break-all">{value || "…"}</dd>
    </div>
  );
}

function inputClass(error?: string) {
  return `w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none ${
    error ? "border-red-400 focus:border-red-600" : "border-border focus:border-foreground"
  }`;
}
