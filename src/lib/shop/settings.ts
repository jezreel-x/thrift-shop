import { cache } from "react";

import { PaymentMethod } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { DEFAULT_MAX_PER_ITEM } from "./availability";
import type { DeliveryOptions } from "./delivery";

/**
 * Settings the shop owner controls, rather than whoever deploys.
 *
 * See the schema comment on ShopSettings for why these are rows and not
 * environment variables.
 */

const SINGLETON = "singleton";

export type PaymentDetails = {
  method: PaymentMethod;
  /** What the buyer will see on their phone when they pay. */
  name: string;
  /** Till number, paybill number, or phone number. */
  number: string;
  /** Paybill only. */
  accountNumber: string | null;
  note: string | null;
};

/**
 * How to pay, or null when the owner has not set it up.
 *
 * Null is a real state the checkout page has to render honestly. Inventing a
 * placeholder till number would be worse than saying nothing: somebody would
 * eventually pay it.
 */
export async function getPaymentDetails(): Promise<PaymentDetails | null> {
  const settings = await prisma.shopSettings.findUnique({ where: { id: SINGLETON } });

  // Both are required for anyone to actually send money.
  if (!settings?.payment || !settings.tillNumber) return null;

  // So is the name. Checkout tells the buyer which name M-Pesa will show and
  // to stop if it shows any other; a guessed name would teach them to ignore
  // the one check that catches a copycat page with someone else's till.
  if (!settings.paymentName) return null;

  // A paybill without an account number cannot be paid either.
  if (settings.payment === PaymentMethod.PAYBILL && !settings.accountNumber) return null;

  return {
    method: settings.payment,
    name: settings.paymentName,
    number: settings.tillNumber,
    accountNumber: settings.accountNumber,
    note: settings.paymentNote,
  };
}

// Saving is staff's job, audited: see src/lib/admin/payment-settings.ts.

/** How the buyer is told to pay, in the words M-Pesa uses on the handset. */
export const PAYMENT_INSTRUCTIONS: Record<PaymentMethod, string> = {
  [PaymentMethod.TILL]: "Lipa na M-Pesa → Buy Goods and Services",
  [PaymentMethod.PAYBILL]: "Lipa na M-Pesa → Pay Bill",
  [PaymentMethod.POCHI]: "M-Pesa → Send Money",
};

export const PAYMENT_NUMBER_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.TILL]: "Till number",
  [PaymentMethod.PAYBILL]: "Business number",
  [PaymentMethod.POCHI]: "Send to number",
};

/**
 * The shop's WhatsApp number, canonical 2547XXXXXXXX, or null when not set —
 * in which case "Order on WhatsApp" is not offered at all.
 */
export async function getShopWhatsApp(): Promise<string | null> {
  const settings = await prisma.shopSettings.findUnique({
    where: { id: SINGLETON },
    select: { whatsappNumber: true },
  });

  return settings?.whatsappNumber ?? null;
}

/**
 * Pickup and the delivery areas with their fees, as the owner set them in
 * Settings. Neither set: checkout asks nothing about delivery.
 */
export async function getDeliveryOptions(): Promise<DeliveryOptions> {
  const [settings, areas] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { id: SINGLETON }, select: { pickupAddress: true } }),
    prisma.deliveryArea.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, feeCents: true },
    }),
  ]);

  return { pickupAddress: settings?.pickupAddress ?? null, areas };
}

/** Rules the owner sets for every buyer. */
export type ShopRules = {
  /** The most of one item (one colour and size) per order; null for no limit. */
  maxPerItem: number | null;
};

/**
 * The shop's rules, once per request: the product page, its cards and the
 * cart all ask. With no settings saved yet, the defaults.
 */
export const getShopRules = cache(async (): Promise<ShopRules> => {
  const settings = await prisma.shopSettings.findUnique({
    where: { id: SINGLETON },
    select: { maxPerItem: true },
  });

  return { maxPerItem: settings ? settings.maxPerItem : DEFAULT_MAX_PER_ITEM };
});
