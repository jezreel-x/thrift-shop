import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";

/**
 * What the shop does with stock outside the website: sold in person or on
 * WhatsApp, held for somebody who asked in a chat.
 *
 * Each action takes the variant's row lock first — the same lock checkout and
 * confirming a sale take — so it counts what buyers hold only after anyone
 * already reserving has finished. That is what lets these promises hold:
 *
 *   - "Sold elsewhere" only takes free units. A unit in a buyer's checkout is
 *     theirs; selling it over the counter would sell it twice.
 *   - A WhatsApp hold only holds free units, and counts against the website
 *     exactly like a buyer's own hold.
 *
 * Every change is a StockMovement and an audit entry with who made it.
 */

/** Staff holds are told apart from buyers' own by their holder. */
const WHATSAPP = "whatsapp:";

export const HOLD_DURATIONS = {
  "2h": { hours: 2, label: "2 hours" },
  "1d": { hours: 24, label: "1 day" },
  "3d": { hours: 72, label: "3 days" },
} as const;
export type HoldDuration = keyof typeof HOLD_DURATIONS;

const MAX_NOTE = 80;
const MAX_UNITS = 99;
const HISTORY_LENGTH = 30;

export type StockRefusal =
  /** No such variant or hold, or the product has been taken off the shop. */
  | "gone"
  /** Fewer free units than asked for. */
  | "not-enough"
  /** The WhatsApp hold ran out; its units may be someone else's now. */
  | "lapsed"
  | "bad-input";

export type StockResult =
  | { ok: true; productId: string }
  | { ok: false; reason: StockRefusal; free?: number; productId?: string };

type LockedVariant = { id: string; productId: string; stock: number; deletedAt: Date | null };

/** Locks a variant's row; null if there is no such variant. */
async function lockVariant(
  tx: Prisma.TransactionClient,
  variantId: string,
): Promise<LockedVariant | null> {
  const [row] = await tx.$queryRaw<LockedVariant[]>`
    SELECT v."id", v."productId", v."stock", p."deletedAt"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
     WHERE v."id" = ${variantId}
       FOR UPDATE OF v
  `;

  return row ?? null;
}

/** Units in unexpired holds on a variant, everybody's. */
async function heldUnits(
  tx: Prisma.TransactionClient,
  variantId: string,
  now: Date,
): Promise<number> {
  const { _sum } = await tx.stockHold.aggregate({
    where: { variantId, expiresAt: { gt: now } },
    _sum: { quantity: true },
  });

  return _sum.quantity ?? 0;
}

function validUnits(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_UNITS;
}

/**
 * Takes units sold in the shop or on WhatsApp off the website.
 *
 * Only free units: if the last one is in somebody's checkout, the owner is
 * told so rather than having the buyer's unit taken from under them.
 */
export async function markSoldElsewhere(input: {
  variantId: string;
  quantity: number;
  actorId: string;
  now?: Date;
}): Promise<StockResult> {
  if (!validUnits(input.quantity)) return { ok: false, reason: "bad-input" };
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx): Promise<StockResult> => {
    const variant = await lockVariant(tx, input.variantId);
    if (!variant) return { ok: false, reason: "gone" };

    const free = variant.stock - (await heldUnits(tx, variant.id, now));
    if (free < input.quantity) {
      return {
        ok: false,
        reason: "not-enough",
        free: Math.max(free, 0),
        productId: variant.productId,
      };
    }

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stock: { decrement: input.quantity } },
    });
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        change: -input.quantity,
        reason: "sold elsewhere",
        actorId: input.actorId,
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stock.sold-elsewhere",
      entityType: "Product",
      entityId: variant.productId,
      after: {
        variantId: variant.id,
        quantity: input.quantity,
        stock: variant.stock - input.quantity,
      },
    });

    return { ok: true, productId: variant.productId };
  });
}

/**
 * Holds units for somebody who asked on WhatsApp, for a while.
 *
 * Counts against the website like any hold: a buyer online sees them as
 * taken. Refused, not shortened, when fewer are free — the owner is about to
 * promise these to somebody, and should know before they do.
 */
export async function holdForWhatsApp(input: {
  variantId: string;
  quantity: number;
  note: string;
  duration: HoldDuration;
  actorId: string;
  now?: Date;
}): Promise<StockResult> {
  const note = input.note.trim().replace(/\s+/g, " ");
  const duration = HOLD_DURATIONS[input.duration];
  if (!validUnits(input.quantity) || !note || note.length > MAX_NOTE || !duration) {
    return { ok: false, reason: "bad-input" };
  }
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx): Promise<StockResult> => {
    const variant = await lockVariant(tx, input.variantId);
    if (!variant || variant.deletedAt) return { ok: false, reason: "gone" };

    const free = variant.stock - (await heldUnits(tx, variant.id, now));
    if (free < input.quantity) {
      return {
        ok: false,
        reason: "not-enough",
        free: Math.max(free, 0),
        productId: variant.productId,
      };
    }

    const hold = await tx.stockHold.create({
      data: {
        variantId: variant.id,
        // Each chat its own hold, never merged with another buyer's.
        holder: `${WHATSAPP}${randomUUID()}`,
        quantity: input.quantity,
        expiresAt: new Date(now.getTime() + duration.hours * 3_600_000),
        note,
        placedById: input.actorId,
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stock.hold",
      entityType: "Product",
      entityId: variant.productId,
      after: {
        hold: hold.id,
        variantId: variant.id,
        quantity: input.quantity,
        note,
        until: hold.expiresAt.toISOString(),
      },
    });

    return { ok: true, productId: variant.productId };
  });
}

/**
 * The WhatsApp buyer paid: the held units leave stock.
 *
 * Only a live hold. Once it has run out its units may be in somebody else's
 * checkout; the owner can use Sold elsewhere, which checks what is free.
 */
export async function sellWhatsAppHold(input: {
  holdId: string;
  actorId: string;
  now?: Date;
}): Promise<StockResult> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx): Promise<StockResult> => {
    const found = await tx.stockHold.findUnique({ where: { id: input.holdId } });
    if (!found || !found.holder.startsWith(WHATSAPP)) return { ok: false, reason: "gone" };

    const variant = await lockVariant(tx, found.variantId);
    // Read again under the lock: it may have been sold or released meanwhile.
    const hold = await tx.stockHold.findUnique({ where: { id: input.holdId } });
    if (!variant || !hold) return { ok: false, reason: "gone" };
    if (hold.expiresAt <= now) {
      return { ok: false, reason: "lapsed", productId: variant.productId };
    }
    // The owner may have lowered stock below the hold; never sell what isn't there.
    if (variant.stock < hold.quantity) {
      return { ok: false, reason: "not-enough", free: variant.stock, productId: variant.productId };
    }

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stock: { decrement: hold.quantity } },
    });
    await tx.stockHold.delete({ where: { id: hold.id } });
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        change: -hold.quantity,
        reason: "sold on WhatsApp",
        actorId: input.actorId,
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stock.sell-hold",
      entityType: "Product",
      entityId: variant.productId,
      after: { hold: hold.id, variantId: variant.id, quantity: hold.quantity, note: hold.note },
    });

    return { ok: true, productId: variant.productId };
  });
}

/** The WhatsApp buyer isn't coming: the units go back on the website. */
export async function releaseWhatsAppHold(input: {
  holdId: string;
  actorId: string;
}): Promise<StockResult> {
  return prisma.$transaction(async (tx): Promise<StockResult> => {
    const hold = await tx.stockHold.findUnique({
      where: { id: input.holdId },
      include: { variant: { select: { productId: true } } },
    });
    // Never a buyer's own checkout hold: releasing that would let their units
    // be sold while they pay.
    if (!hold || !hold.holder.startsWith(WHATSAPP)) return { ok: false, reason: "gone" };

    await tx.stockHold.delete({ where: { id: hold.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stock.release-hold",
      entityType: "Product",
      entityId: hold.variant.productId,
      before: {
        hold: hold.id,
        variantId: hold.variantId,
        quantity: hold.quantity,
        note: hold.note,
      },
    });

    return { ok: true, productId: hold.variant.productId };
  });
}

/* ------------------------------------------------------------- the screen */

export type StockRow = {
  id: string;
  label: string;
  swatch: string | null;
  hex: string | null;
  option2: string | null;
  /** Its own price, or the product's. */
  priceCents: number;
  stock: number;
  /** In buyers' checkouts on the website. */
  inCheckout: number;
  /** In WhatsApp holds. */
  onWhatsApp: number;
  free: number;
};

export type WhatsAppHold = {
  id: string;
  label: string;
  quantity: number;
  note: string;
  expiresAt: Date;
  lapsed: boolean;
  placedBy: string | null;
};

export type StockEvent = {
  id: string;
  at: Date;
  label: string;
  change: number;
  reason: string;
  by: string | null;
  orderReference: string | null;
};

export type StockView = {
  product: {
    id: string;
    title: string;
    slug: string;
    priceCents: number;
    withdrawn: boolean;
    option1Name: string | null;
    option2Name: string | null;
  };
  rows: StockRow[];
  holds: WhatsAppHold[];
  history: StockEvent[];
};

export async function getStockView(
  productId: string,
  now: Date = new Date(),
): Promise<StockView | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      slug: true,
      priceCents: true,
      deletedAt: true,
      categoryRef: { select: { option1Name: true, option2Name: true, option2Values: true } },
      swatches: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } },
      variants: {
        select: {
          id: true,
          option2: true,
          stock: true,
          priceCents: true,
          swatchId: true,
          swatch: { select: { name: true, hex: true } },
          holds: {
            orderBy: { expiresAt: "asc" },
            select: {
              id: true,
              holder: true,
              quantity: true,
              expiresAt: true,
              note: true,
              placedById: true,
            },
          },
        },
      },
    },
  });
  if (!product) return null;

  // Colour in the owner's order, then size in the category's.
  const swatchOrder = product.swatches.map((swatch) => swatch.id);
  const sizeOrder = product.categoryRef?.option2Values ?? [];
  const rank = (list: (string | null)[], value: string | null) => {
    const at = list.indexOf(value);
    return at === -1 ? list.length : at;
  };
  const variants = [...product.variants].sort(
    (a, b) =>
      rank(swatchOrder, a.swatchId) - rank(swatchOrder, b.swatchId) ||
      rank(sizeOrder, a.option2) - rank(sizeOrder, b.option2),
  );
  const labelOf = (variant: (typeof variants)[number]) =>
    [variant.swatch?.name, variant.option2].filter(Boolean).join(" · ") || product.title;

  const rows = variants.map((variant): StockRow => {
    const live = variant.holds.filter((hold) => hold.expiresAt > now);
    const onWhatsApp = live
      .filter((hold) => hold.holder.startsWith(WHATSAPP))
      .reduce((sum, hold) => sum + hold.quantity, 0);
    const inCheckout = live.reduce((sum, hold) => sum + hold.quantity, 0) - onWhatsApp;

    return {
      id: variant.id,
      label: labelOf(variant),
      swatch: variant.swatch?.name ?? null,
      hex: variant.swatch?.hex ?? null,
      option2: variant.option2,
      priceCents: variant.priceCents ?? product.priceCents,
      stock: variant.stock,
      inCheckout,
      onWhatsApp,
      free: Math.max(variant.stock - inCheckout - onWhatsApp, 0),
    };
  });

  const whatsAppHolds = variants.flatMap((variant) =>
    variant.holds
      .filter((hold) => hold.holder.startsWith(WHATSAPP))
      .map((hold) => ({ ...hold, label: labelOf(variant) })),
  );

  const movements = await prisma.stockMovement.findMany({
    where: { variant: { productId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LENGTH,
    select: {
      id: true,
      createdAt: true,
      change: true,
      reason: true,
      actorId: true,
      orderId: true,
      variant: { select: { option2: true, swatch: { select: { name: true } } } },
    },
  });

  const people = await namesOf([
    ...whatsAppHolds.map((hold) => hold.placedById),
    ...movements.map((movement) => movement.actorId),
  ]);
  const orderIds = movements.flatMap((movement) => (movement.orderId ? [movement.orderId] : []));
  const orders = new Map(
    (
      await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, reference: true },
      })
    ).map((order) => [order.id, order.reference]),
  );

  return {
    product: {
      id: product.id,
      title: product.title,
      slug: product.slug,
      priceCents: product.priceCents,
      withdrawn: product.deletedAt !== null,
      option1Name: product.categoryRef?.option1Name ?? null,
      option2Name: product.categoryRef?.option2Name ?? null,
    },
    rows,
    holds: whatsAppHolds.map((hold) => ({
      id: hold.id,
      label: hold.label,
      quantity: hold.quantity,
      note: hold.note ?? "",
      expiresAt: hold.expiresAt,
      lapsed: hold.expiresAt <= now,
      placedBy: hold.placedById ? (people.get(hold.placedById) ?? null) : null,
    })),
    history: movements.map((movement) => ({
      id: movement.id,
      at: movement.createdAt,
      label:
        [movement.variant.swatch?.name, movement.variant.option2].filter(Boolean).join(" · ") ||
        product.title,
      change: movement.change,
      reason: movement.reason,
      by: movement.actorId ? (people.get(movement.actorId) ?? "A former staff member") : null,
      orderReference: movement.orderId ? (orders.get(movement.orderId) ?? null) : null,
    })),
  };
}

async function namesOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, email: true },
  });

  return new Map(users.map((user) => [user.id, user.name || user.email]));
}
