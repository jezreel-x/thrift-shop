"use server";

import { revalidatePath } from "next/cache";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "./access";
import {
  type AreaInput,
  getDeliverySettings,
  parseDeliverySettings,
  saveDeliverySettings,
} from "./delivery-settings";
import { centsToInput } from "./products";
import {
  type PaymentSettingsField,
  clearPaymentSettings,
  parsePaymentSettings,
  savePaymentSettings,
  saveWhatsAppNumber,
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
  revalidatePath("/admin/settings", "layout");

  return { saved: changed ? "changed" : "unchanged" };
}

/**
 * Removes the payment details. Same permission as changing them: taking the
 * shop's payments offline is as consequential as redirecting them.
 */
export async function clearPaymentSettingsAction(): Promise<void> {
  const { user } = await requirePermission(Permission.SETTINGS_EDIT);

  await clearPaymentSettings({ actorId: user.id });

  revalidatePath("/admin/settings", "layout");
}

export type WhatsAppFormState = { error?: string; saved?: "changed" | "unchanged" };

/** Sets the number "Order on WhatsApp" opens. Same permission as payment details. */
export async function saveWhatsAppAction(
  _previous: WhatsAppFormState,
  formData: FormData,
): Promise<WhatsAppFormState> {
  const { user } = await requirePermission(Permission.SETTINGS_EDIT);

  const result = await saveWhatsAppNumber({
    raw: String(formData.get("whatsappNumber") ?? ""),
    actorId: user.id,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/settings", "layout");

  return { saved: result.changed ? "changed" : "unchanged" };
}

export type DeliverySettingsFormState = {
  errors?: Record<string, string>;
  saved?: "changed" | "unchanged";
  /** The list as saved, with ids for new rows, for the form to carry on from. */
  areas?: { id: string; name: string; fee: string }[];
};

/**
 * Saves pickup and the delivery areas. SETTINGS_EDIT: a fee is part of what
 * every buyer who chooses that area is asked to pay.
 */
export async function saveDeliverySettingsAction(
  _previous: DeliverySettingsFormState,
  formData: FormData,
): Promise<DeliverySettingsFormState> {
  const { user } = await requirePermission(Permission.SETTINGS_EDIT);

  let areas: AreaInput[];
  try {
    areas = JSON.parse(String(formData.get("areas") ?? "[]")) as AreaInput[];
    if (
      !Array.isArray(areas) ||
      !areas.every(
        (area) =>
          (area.id === null || typeof area.id === "string") &&
          typeof area.name === "string" &&
          typeof area.fee === "string",
      )
    ) {
      throw new Error("bad areas");
    }
  } catch {
    return { errors: { areas: "The list could not be read. Reload and try again." } };
  }

  const parsed = parseDeliverySettings({
    pickupAddress: String(formData.get("pickupAddress") ?? ""),
    areas,
  });
  if (!parsed.ok) return { errors: parsed.errors };

  const result = await saveDeliverySettings({ value: parsed.value, actorId: user.id });
  if (!result.ok) return { errors: { areas: result.error } };

  revalidatePath("/admin/settings", "layout");
  revalidatePath("/checkout");

  const saved = await getDeliverySettings();

  return {
    saved: result.changed ? "changed" : "unchanged",
    areas: saved.areas.map((area) => ({
      id: area.id!,
      name: area.name,
      fee: centsToInput(area.feeCents),
    })),
  };
}
