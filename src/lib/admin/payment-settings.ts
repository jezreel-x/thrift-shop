import { PaymentMethod } from "@/generated/prisma/enums";
import { formatPhone, normalisePhone } from "../phone";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";

/**
 * Where buyers send money, as set by the owner.
 *
 * The most sensitive setting in the shop. Change the till number and every
 * payment after that goes somewhere else — which is why every change is
 * audited with the old and new values, and shown on the settings page with
 * who made it. Swapping in your own number is the insider fraud this screen
 * most needs to make visible.
 */

const SINGLETON = "singleton";

export type PaymentSettings = {
  method: PaymentMethod;
  /** Till or paybill number, or the Send Money phone in canonical 2547XXXXXXXX form. */
  number: string;
  /** Paybill only. */
  accountNumber: string | null;
  /** Exactly what M-Pesa shows the buyer before they enter their PIN. */
  name: string;
  note: string | null;
};

export type PaymentSettingsField = keyof PaymentSettings;

export type ParseResult =
  | { ok: true; value: PaymentSettings }
  | { ok: false; errors: Partial<Record<PaymentSettingsField, string>> };

const BUSINESS_NUMBER = /^\d{5,8}$/;
const ACCOUNT_NUMBER = /^[A-Za-z0-9 -]{1,24}$/;
const MAX_NAME = 60;
const MAX_NOTE = 200;

/**
 * Checks what the owner typed.
 *
 * Forgiving about presentation — spaces in a till number, a phone written
 * "0712 345 678" — and strict about substance, because a wrong digit here is
 * not a typo the buyer can see past: it sends their money to a stranger.
 */
export function parsePaymentSettings(input: Record<string, unknown>): ParseResult {
  const errors: Partial<Record<PaymentSettingsField, string>> = {};
  const text = (key: string) =>
    (typeof input[key] === "string" ? (input[key] as string) : "").trim();

  const methodText = text("method");
  const method = (Object.values(PaymentMethod) as string[]).includes(methodText)
    ? (methodText as PaymentMethod)
    : null;
  if (!method) errors.method = "Choose how buyers pay.";

  let number = "";
  const rawNumber = text("number");
  if (method === PaymentMethod.POCHI) {
    const phone = normalisePhone(rawNumber);
    if (phone) number = phone;
    else errors.number = "Enter the Safaricom number buyers send money to, like 0712 345 678.";
  } else if (method) {
    number = rawNumber.replace(/\s/g, "");
    if (!BUSINESS_NUMBER.test(number)) {
      errors.number =
        method === PaymentMethod.TILL
          ? "A till number is 5 to 8 digits."
          : "A paybill (business) number is 5 to 8 digits.";
    }
  }

  let accountNumber: string | null = null;
  if (method === PaymentMethod.PAYBILL) {
    accountNumber = text("accountNumber").replace(/\s+/g, " ");
    if (!ACCOUNT_NUMBER.test(accountNumber)) {
      errors.accountNumber = "Enter the account number buyers type, up to 24 letters or digits.";
    }
  }

  const name = text("name").replace(/\s+/g, " ");
  if (name.length < 2) {
    errors.name = "Enter the name M-Pesa shows buyers before they pay.";
  } else if (name.length > MAX_NAME) {
    errors.name = `Keep the name under ${MAX_NAME} characters.`;
  }

  const note = text("note");
  if (note.length > MAX_NOTE) errors.note = `Keep the note under ${MAX_NOTE} characters.`;

  if (!method || Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { method, number, accountNumber, name, note: note || null } };
}

/** What the form starts with: the saved values, as the owner would type them. */
export type PaymentSettingsFormValues = Record<PaymentSettingsField, string>;

export async function getPaymentSettingsFormValues(): Promise<PaymentSettingsFormValues> {
  const row = await prisma.shopSettings.findUnique({ where: { id: SINGLETON } });

  return {
    method: row?.payment ?? "",
    // A Pochi number is stored canonically; shown the way a Kenyan writes it.
    number:
      row?.payment === PaymentMethod.POCHI && row.tillNumber
        ? formatPhone(row.tillNumber)
        : (row?.tillNumber ?? ""),
    accountNumber: row?.accountNumber ?? "",
    name: row?.paymentName ?? "",
    note: row?.paymentNote ?? "",
  };
}

/** Saves the settings and records who changed what, in one transaction. */
export async function savePaymentSettings(input: {
  value: PaymentSettings;
  actorId: string;
}): Promise<{ changed: boolean }> {
  const { value } = input;

  return prisma.$transaction(async (tx) => {
    const before = await tx.shopSettings.findUnique({ where: { id: SINGLETON } });
    const data = {
      payment: value.method,
      tillNumber: value.number,
      accountNumber: value.accountNumber,
      paymentName: value.name,
      paymentNote: value.note,
    };

    const unchanged =
      before !== null &&
      before.payment === data.payment &&
      before.tillNumber === data.tillNumber &&
      before.accountNumber === data.accountNumber &&
      before.paymentName === data.paymentName &&
      before.paymentNote === data.paymentNote;
    // Saving the same values twice is not a change, and should not bury the
    // real changes in the history.
    if (unchanged) return { changed: false };

    await tx.shopSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...data },
      update: data,
    });

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "settings.update-payment",
      entityType: "ShopSettings",
      entityId: SINGLETON,
      before: before
        ? {
            method: before.payment,
            number: before.tillNumber,
            accountNumber: before.accountNumber,
            name: before.paymentName,
            note: before.paymentNote,
          }
        : undefined,
      after: {
        method: data.payment,
        number: data.tillNumber,
        accountNumber: data.accountNumber,
        name: data.paymentName,
        note: data.paymentNote,
      },
    });

    return { changed: true };
  });
}

/**
 * Removes the payment details, so checkout says payment is not set up and
 * nobody can pay until new details are saved.
 *
 * For a shop that is not ready to take money yet — or a sample shop that
 * should not be showing anybody's real number. Audited like a change, with
 * what was removed, so it can be put back by hand.
 */
export async function clearPaymentSettings(input: {
  actorId: string;
}): Promise<{ changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.shopSettings.findUnique({ where: { id: SINGLETON } });
    if (!before?.payment && !before?.tillNumber && !before?.paymentName) return { changed: false };

    await tx.shopSettings.update({
      where: { id: SINGLETON },
      data: {
        payment: null,
        tillNumber: null,
        accountNumber: null,
        paymentName: null,
        paymentNote: null,
      },
    });

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "settings.clear-payment",
      entityType: "ShopSettings",
      entityId: SINGLETON,
      before: {
        method: before.payment,
        number: before.tillNumber,
        accountNumber: before.accountNumber,
        name: before.paymentName,
        note: before.paymentNote,
      },
    });

    return { changed: true };
  });
}

export type PaymentSettingsChange = {
  id: string;
  createdAt: Date;
  actor: string;
  /** Human-readable differences: "Till number: 123456 → 654321". */
  changes: string[];
};

/** The latest changes to the payment settings, newest first. */
export async function listPaymentSettingsHistory(limit = 10): Promise<PaymentSettingsChange[]> {
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: "ShopSettings",
      action: { in: ["settings.update-payment", "settings.clear-payment"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      createdAt: true,
      before: true,
      after: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    actor: entry.actor?.name ?? entry.actor?.email ?? "a script",
    changes:
      entry.action === "settings.clear-payment"
        ? ["Payment details removed: checkout shows payment as not set up"]
        : describeChanges(asRecord(entry.before), asRecord(entry.after)),
  }));
}

const FIELD_LABELS: Record<string, string> = {
  method: "Method",
  number: "Number",
  accountNumber: "Account number",
  name: "Name M-Pesa shows",
  note: "Note",
};

/** Pure: the differences between two saved versions, in words. Exported for tests. */
export function describeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (!after) return [];
  if (!before) return ["Payment details set for the first time"];

  return Object.keys(FIELD_LABELS)
    .filter((key) => (before[key] ?? null) !== (after[key] ?? null))
    .map((key) => `${FIELD_LABELS[key]}: ${show(key, before[key])} → ${show(key, after[key])}`);
}

/** The words the owner chose between, not the stored values. */
const METHOD_LABELS: Record<string, string> = {
  [PaymentMethod.TILL]: "Till",
  [PaymentMethod.PAYBILL]: "Paybill",
  [PaymentMethod.POCHI]: "Send Money",
};

function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (key === "method" && typeof value === "string") return METHOD_LABELS[value] ?? value;
  if (key === "number" && typeof value === "string" && value.startsWith("254")) {
    return formatPhone(value);
  }

  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
