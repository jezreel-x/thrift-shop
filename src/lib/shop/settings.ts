import { PaymentMethod } from "@/generated/prisma/enums";
import { prisma } from "../prisma";

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

  // A paybill without an account number cannot be paid either.
  if (settings.payment === PaymentMethod.PAYBILL && !settings.accountNumber) return null;

  return {
    method: settings.payment,
    name: settings.paymentName ?? "The Thrift Plug",
    number: settings.tillNumber,
    accountNumber: settings.accountNumber,
    note: settings.paymentNote,
  };
}

/** Creates the row if it is missing, so the Phase 3 form always has one to edit. */
export async function updatePaymentDetails(input: {
  method: PaymentMethod | null;
  name?: string | null;
  number?: string | null;
  accountNumber?: string | null;
  note?: string | null;
}): Promise<void> {
  const data = {
    payment: input.method,
    paymentName: input.name ?? null,
    tillNumber: input.number ?? null,
    // Only a paybill has one; keeping a stale value would show an account
    // number beside a till, which is how a payment goes astray.
    accountNumber: input.method === PaymentMethod.PAYBILL ? (input.accountNumber ?? null) : null,
    paymentNote: input.note ?? null,
  };

  await prisma.shopSettings.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data },
    update: data,
  });
}

/** How the buyer is told to pay, in the words M-Pesa uses on the handset. */
export const PAYMENT_INSTRUCTIONS: Record<PaymentMethod, string> = {
  [PaymentMethod.TILL]: "Lipa na M-Pesa → Buy Goods and Services",
  [PaymentMethod.PAYBILL]: "Lipa na M-Pesa → Pay Bill",
  [PaymentMethod.POCHI]: "M-Pesa → Send Money",
};

export const PAYMENT_NUMBER_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.TILL]: "Till number",
  [PaymentMethod.PAYBILL]: "Business number",
  [PaymentMethod.POCHI]: "Phone number",
};
