import { prisma } from "../prisma";
import { DEFAULT_MAX_PER_ITEM } from "../shop/availability";
import { recordAudit } from "./audit";

/**
 * Rules the owner sets for every buyer. For now one: the most of one item (one
 * colour and size) a buyer can put in an order.
 *
 * Checkout holds stock while a person checks the payment, up to a day; without
 * a limit one buyer could hold a whole size for that long. Shops that sell in
 * bulk raise it or turn it off. Audited, like the other settings.
 */

const SINGLETON = "singleton";
const MAX_LIMIT = 999;

export type ShopRulesValue = { maxPerItem: number | null };

export type ShopRulesParse = { ok: true; value: ShopRulesValue } | { ok: false; error: string };

/** Pure: the form's number, or "no limit". */
export function parseShopRules(input: { maxPerItem: string; noLimit: boolean }): ShopRulesParse {
  if (input.noLimit) return { ok: true, value: { maxPerItem: null } };

  const raw = input.maxPerItem.trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) {
    return { ok: false, error: `Enter a whole number from 1 to ${MAX_LIMIT}, or tick No limit.` };
  }

  return { ok: true, value: { maxPerItem: Number(raw) } };
}

export async function getShopRulesFormValue(): Promise<ShopRulesValue> {
  const settings = await prisma.shopSettings.findUnique({
    where: { id: SINGLETON },
    select: { maxPerItem: true },
  });

  return { maxPerItem: settings ? settings.maxPerItem : DEFAULT_MAX_PER_ITEM };
}

export async function saveShopRules(input: {
  value: ShopRulesValue;
  actorId: string;
}): Promise<{ changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.shopSettings.findUnique({
      where: { id: SINGLETON },
      select: { maxPerItem: true },
    });
    const before = current ? current.maxPerItem : DEFAULT_MAX_PER_ITEM;
    if (before === input.value.maxPerItem) return { changed: false };

    await tx.shopSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, maxPerItem: input.value.maxPerItem },
      update: { maxPerItem: input.value.maxPerItem },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "settings.update-rules",
      entityType: "ShopSettings",
      entityId: SINGLETON,
      before: { maxPerItem: before },
      after: { maxPerItem: input.value.maxPerItem },
    });

    return { changed: true };
  });
}

/** Pure: a change in words, for the settings history. */
export function describeRulesChange(before: unknown, after: unknown): string[] {
  const limit = (value: unknown) =>
    typeof value === "number" ? `${value}` : value === null ? "no limit" : "(none)";
  const read = (snapshot: unknown) =>
    typeof snapshot === "object" && snapshot !== null && "maxPerItem" in snapshot
      ? snapshot.maxPerItem
      : undefined;

  return [`Most of one item per order: ${limit(read(before))} → ${limit(read(after))}`];
}
