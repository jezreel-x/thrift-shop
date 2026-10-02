"use server";

import { revalidatePath } from "next/cache";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "./access";
import {
  type PaymentSettingsField,
  parsePaymentSettings,
  savePaymentSettings,
} from "./payment-settings";

export type PaymentSettingsFormState = {
  errors?: Partial<Record<PaymentSettingsField, string>>;
  saved?: "changed" | "unchanged";
};

/**
 * Saves where buyers send money. SETTINGS_EDIT only: of everything in the
 * admin, this is the change that can redirect the shop's income.
 */
export async function savePaymentSettingsAction(
  _previous: PaymentSettingsFormState,
  formData: FormData,
): Promise<PaymentSettingsFormState> {
  const { user } = await requirePermission(Permission.SETTINGS_EDIT);

  const parsed = parsePaymentSettings(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const { changed } = await savePaymentSettings({ value: parsed.value, actorId: user.id });

  // The change history on the settings page reads the audit log.
  revalidatePath("/admin/settings");

  return { saved: changed ? "changed" : "unchanged" };
}
