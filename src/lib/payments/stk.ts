import type { Prisma } from "@/generated/prisma/client";
import {
  OrderStatus,
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
  SettledVia,
} from "@/generated/prisma/enums";
import { recordAudit } from "../admin/audit";
import { type MpesaConfig, mpesaConfig } from "../mpesa/config";
import {
  type PushResult,
  type StkCallback,
  type StkVerdict,
  stkPush,
  stkQuery,
} from "../mpesa/daraja";
import { normalisePhone } from "../phone";
import { prisma } from "../prisma";
import { heldUntil } from "../shop/orders";
import type { PaymentDetails } from "../shop/settings";
import { settleItemsIn } from "./settle";

/**
 * Paying by M-Pesa prompt (STK Push): sending the prompt, and settling it.
 *
 * Every path that learns how a prompt ended goes through {@link checkPrompt},
 * which asks Safaricom itself and settles on that answer:
 *
 *   Safaricom's callback   — fast, when it comes; but it is a public URL
 *                            anyone can post to, and some paybills never
 *                            receive it at all
 *   the buyer's page       — asks while the buyer waits
 *   the daily housekeeping — catches whatever nobody was waiting for
 *   staff                  — "Check M-Pesa status" on the order
 *
 * So the callback is a hint that something happened, never proof of what. A
 * forged "paid" is refused, a forged "failed" can't cancel a real payment, and
 * when Safaricom can't be reached nothing changes until someone asks again.
 *
 * A paid prompt then settles by the same rule as every other payment
 * (settle.ts): sold if the units are still the buyer's or free, otherwise the
 * order needs a refund. The payment's row is locked while it settles, so the
 * callback, the page and the housekeeping racing each other settle it once.
 */

/** How long sending a prompt extends the buyer's hold: time to find the phone and type a PIN. */
export const PROMPT_HOLD_MINUTES = 5;
/** Leave a fresh prompt alone this long: the buyer is still typing their PIN. */
export const FIRST_CHECK_AFTER_MS = 20_000;
/** Ask about one prompt at most this often from the buyer's page. */
export const CHECK_SPACING_MS = 10_000;
/** A row that never got Safaricom's handle (a crash mid-send) is given up after this. */
const UNSENT_AFTER_MS = 60_000;

type Deps = {
  config?: MpesaConfig | null;
  push?: (config: MpesaConfig, input: Parameters<typeof stkPush>[1]) => Promise<PushResult>;
  query?: (config: MpesaConfig, checkoutRequestId: string) => Promise<StkVerdict>;
  now?: Date;
};

const configOf = (deps: Deps) => (deps.config === undefined ? mpesaConfig() : deps.config);

/**
 * Whether checkout offers the prompt. Needs prompts switched on, a till or
 * paybill (Pochi la Biashara has no API), and, with live keys, the money going
 * to the number checkout shows: a mismatch is how money reaches the wrong
 * account. The sandbox pays Safaricom's shared test paybill, so it is exempt.
 */
export function promptsOffered(
  payment: PaymentDetails | null,
  config: MpesaConfig | null = mpesaConfig(),
): boolean {
  if (!config || !payment || payment.method === PaymentMethod.POCHI) return false;
  if (config.environment === "sandbox") return true;

  return config.partyB === payment.number;
}

// --- Sending ----------------------------------------------------------------

export type PromptRefusal =
  | "not-found"
  /** Not waiting for payment any more: paid, claimed or closed. */
  | "not-payable"
  | "hold-lapsed"
  /** A prompt is already out; wait for it to end. */
  | "prompt-pending"
  | "not-offered"
  /** Daraja takes whole shillings, and a total is never rounded. */
  | "odd-amount"
  | "bad-phone"
  /** Safaricom wouldn't send it. */
  | "refused";

export type PromptResult =
  { ok: true; reference: string } | { ok: false; reason: PromptRefusal; detail?: string };

export async function requestPrompt(
  input: { orderId: string; userId: string; phone: string; payment: PaymentDetails | null },
  deps: Deps = {},
): Promise<PromptResult> {
  const config = configOf(deps);
  if (!config || !promptsOffered(input.payment, config))
    return { ok: false, reason: "not-offered" };

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, reason: "bad-phone" };

  const now = deps.now ?? new Date();

  // Record the attempt before calling Safaricom, under the order's lock, so two
  // taps of the button can't send two prompts.
  const started = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} AND "userId" = ${input.userId} FOR UPDATE
    `;
    if (!locked) return { ok: false as const, reason: "not-found" as const };

    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: {
        id: true,
        userId: true,
        reference: true,
        status: true,
        totalCents: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      return { ok: false as const, reason: "not-payable" as const };
    }
    if (!(await heldUntil([order], now)).get(order.id)) {
      return { ok: false as const, reason: "hold-lapsed" as const };
    }
    if (order.totalCents % 100 !== 0) return { ok: false as const, reason: "odd-amount" as const };

    // A row left PENDING without Safaricom's handle never reached a phone.
    await tx.payment.updateMany({
      where: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        checkoutRequestId: null,
        createdAt: { lt: new Date(now.getTime() - UNSENT_AFTER_MS) },
      },
      data: { status: PaymentStatus.FAILED, resultDesc: "The prompt was never sent." },
    });
    const pending = await tx.payment.count({
      where: { orderId: order.id, status: PaymentStatus.PENDING },
    });
    if (pending > 0) return { ok: false as const, reason: "prompt-pending" as const };

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        channel: PaymentChannel.MPESA_STK,
        status: PaymentStatus.PENDING,
        amountCents: order.totalCents,
        phone,
        createdAt: now,
      },
      select: { id: true },
    });

    return { ok: true as const, order, paymentId: payment.id };
  });
  if (!started.ok) return started;

  const { order, paymentId } = started;
  const sent = await (deps.push ?? stkPush)(config, {
    amount: order.totalCents / 100,
    phone,
    reference: order.reference,
    description: `Order ${order.reference.slice(3)}`,
  });

  if (!sent.ok) {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.FAILED, resultDesc: sent.detail },
    });

    return { ok: false, reason: "refused", detail: sent.detail };
  }

  const until = new Date(now.getTime() + PROMPT_HOLD_MINUTES * 60_000);
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: {
        checkoutRequestId: sent.checkoutRequestId,
        merchantRequestId: sent.merchantRequestId || null,
      },
    }),
    // Real progress towards paying, so the one thing besides a claimed code
    // that extends a hold: never shortens one, never revives a lapsed one.
    prisma.stockHold.updateMany({
      where: {
        holder: order.userId,
        variantId: { in: order.items.map((item) => item.variantId) },
        expiresAt: { gt: now, lt: until },
      },
      data: { expiresAt: until },
    }),
  ]);

  return { ok: true, reference: order.reference };
}

// --- Settling ---------------------------------------------------------------

export type SettleResult = {
  /** Whether this call moved the payment out of PENDING. */
  changed: boolean;
  status: PaymentStatus;
  /** For a paid prompt: what happened to the order. */
  outcome?: "confirmed" | "needs-refund" | "already-decided";
};

/**
 * Asks Safaricom how a prompt ended, and settles on its answer. The one entry
 * point for every path; see the module comment.
 */
export async function checkPrompt(
  paymentId: string,
  via: SettledVia,
  options: { callback?: StkCallback; actorId?: string } = {},
  deps: Deps = {},
): Promise<SettleResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { status: true, channel: true, checkoutRequestId: true },
  });
  if (!payment) return { changed: false, status: PaymentStatus.FAILED };
  if (
    payment.channel !== PaymentChannel.MPESA_STK ||
    payment.status !== PaymentStatus.PENDING ||
    !payment.checkoutRequestId
  ) {
    return { changed: false, status: payment.status };
  }

  const config = configOf(deps);
  const verdict: StkVerdict = config
    ? await (deps.query ?? stkQuery)(config, payment.checkoutRequestId)
    : { state: "unknown", detail: "M-Pesa prompts are switched off" };

  return settlePrompt(paymentId, verdict, { ...options, via, now: deps.now });
}

/**
 * Applies Safaricom's verdict to a prompt. Only {@link checkPrompt} calls it
 * with a real verdict; exported for tests.
 */
export async function settlePrompt(
  paymentId: string,
  verdict: StkVerdict,
  options: { via: SettledVia; callback?: StkCallback; actorId?: string; now?: Date },
): Promise<SettleResult> {
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // The payment's lock: whoever settles first wins, the rest see it settled.
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { id: true, status: true, orderId: true, amountCents: true },
    });
    if (payment.status !== PaymentStatus.PENDING) {
      return { changed: false, status: payment.status };
    }

    // The callback as it arrived, kept whatever Safaricom says about it.
    const callback = options.callback
      ? { callback: options.callback as unknown as Prisma.InputJsonValue }
      : {};

    if (verdict.state !== "settled") {
      await tx.payment.update({ where: { id: paymentId }, data: { checkedAt: now, ...callback } });

      return { changed: false, status: PaymentStatus.PENDING };
    }

    const settled = {
      resultCode: verdict.resultCode,
      resultDesc: verdict.resultDesc,
      checkedAt: now,
      settledVia: options.via,
      settledAt: now,
      ...callback,
    };

    if (verdict.resultCode !== 0) {
      // Not paid. The order stays open: the buyer can try again, or pay the
      // till, while their hold lasts.
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, ...settled },
      });

      return { changed: true, status: PaymentStatus.FAILED };
    }

    // Paid. The amount is the one we asked for: Safaricom's answer is about
    // this prompt, for this amount, so the callback's own amount is not used.
    // Its receipt is, because only the callback carries one, and only once
    // Safaricom has agreed the prompt was paid.
    const receipt = await unusedReceipt(tx, options.callback);

    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${payment.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      select: {
        status: true,
        userId: true,
        items: { select: { variantId: true, title: true, quantity: true } },
      },
    });

    let outcome: SettleResult["outcome"];
    let missing: string[] | undefined;
    // CANCELLED included: an order closed because its hold ran out while the
    // prompt was still out can still be paid, and is settled like any other.
    if (order.status === OrderStatus.AWAITING_PAYMENT || order.status === OrderStatus.CANCELLED) {
      const sale = await settleItemsIn(tx, {
        orderId: payment.orderId,
        holder: order.userId,
        items: order.items,
        now,
      });
      if (sale.sold) {
        outcome = "confirmed";
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.CONFIRMED, reviewedAt: now, mpesaCode: receipt },
        });
        // Bought, so out of the cart. Only now: a prompt can fail, and the
        // buyer trying again needs their cart as it was.
        await tx.cartItem.deleteMany({
          where: {
            cart: { userId: order.userId },
            variantId: { in: order.items.map((item) => item.variantId) },
          },
        });
      } else {
        outcome = "needs-refund";
        missing = sale.missing;
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.NEEDS_REFUND, reviewedAt: now },
        });
        await tx.stockHold.deleteMany({
          where: {
            variantId: { in: order.items.map((item) => item.variantId) },
            holder: order.userId,
          },
        });
      }
    } else {
      // Decided some other way before this money arrived. Nothing on the order
      // changes; the payment is recorded as received so staff can see it, and
      // the audit entry says it is owed back.
      outcome = "already-decided";
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.RECEIVED, receivedAt: now, receipt, ...settled },
    });

    await recordAudit(tx, {
      actorId: options.actorId ?? null,
      action: "order.prompt-paid",
      entityType: "Order",
      entityId: payment.orderId,
      before: { status: order.status },
      after: {
        status:
          outcome === "confirmed"
            ? OrderStatus.CONFIRMED
            : outcome === "needs-refund"
              ? OrderStatus.NEEDS_REFUND
              : order.status,
        via: options.via,
        ...(receipt ? { receipt } : {}),
        ...(missing ? { missing } : {}),
        ...(outcome === "already-decided" ? { owedBack: payment.amountCents } : {}),
      },
    });

    return { changed: true, status: PaymentStatus.RECEIVED, outcome };
  });
}

/**
 * The callback's receipt, if it has one nobody else holds. A receipt is unique
 * across the shop; one already taken can only come from a forged callback, and
 * must not abort a settlement Safaricom has confirmed.
 */
async function unusedReceipt(
  tx: Prisma.TransactionClient,
  callback: StkCallback | undefined,
): Promise<string | null> {
  const receipt = callback?.resultCode === 0 ? callback.receipt : null;
  if (!receipt) return null;

  const [payment, order] = await Promise.all([
    tx.payment.findUnique({ where: { receipt }, select: { id: true } }),
    tx.order.findUnique({ where: { mpesaCode: receipt }, select: { id: true } }),
  ]);

  return payment || order ? null : receipt;
}

// --- Asking on a schedule ---------------------------------------------------

/**
 * Asks about the prompts nobody has settled: the daily housekeeping's share.
 * The buyer's page settles nearly all of them within a minute; this catches a
 * buyer who closed the page, a callback that never came, and Safaricom being
 * down when they asked.
 */
export async function reconcilePrompts(deps: Deps = {}, limit = 50): Promise<number> {
  const now = deps.now ?? new Date();
  const pending = await prisma.payment.findMany({
    where: {
      channel: PaymentChannel.MPESA_STK,
      status: PaymentStatus.PENDING,
      checkoutRequestId: { not: null },
      createdAt: { lt: new Date(now.getTime() - FIRST_CHECK_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let settled = 0;
  for (const payment of pending) {
    if ((await checkPrompt(payment.id, SettledVia.HOUSEKEEPING, {}, deps)).changed) settled += 1;
  }

  return settled;
}

/**
 * For the buyer's waiting page: asks about their latest prompt if it is old
 * enough and hasn't been asked about just now, so a page polling every few
 * seconds asks Safaricom at most every {@link CHECK_SPACING_MS}.
 */
export async function checkPromptForBuyer(
  reference: string,
  userId: string,
  deps: Deps = {},
): Promise<{ order: OrderStatus; prompt: PaymentStatus | null } | null> {
  const now = deps.now ?? new Date();
  const order = await prisma.order.findFirst({
    where: { reference, userId },
    select: { id: true, status: true },
  });
  if (!order) return null;

  const prompt = await latestPrompt(order.id);
  if (
    prompt?.status === PaymentStatus.PENDING &&
    prompt.createdAt.getTime() <= now.getTime() - FIRST_CHECK_AFTER_MS &&
    (!prompt.checkedAt || prompt.checkedAt.getTime() <= now.getTime() - CHECK_SPACING_MS)
  ) {
    const result = await checkPrompt(prompt.id, SettledVia.BUYER_PAGE, {}, deps);
    if (result.changed) {
      const after = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true },
      });

      return { order: after.status, prompt: result.status };
    }
  }

  return { order: order.status, prompt: prompt?.status ?? null };
}

/** An order's most recent prompt, if it has had one. */
export function latestPrompt(orderId: string) {
  return prisma.payment.findFirst({
    where: { orderId, channel: PaymentChannel.MPESA_STK },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      phone: true,
      amountCents: true,
      resultCode: true,
      resultDesc: true,
      createdAt: true,
      checkedAt: true,
    },
  });
}

/** Safaricom's common result codes, in the buyer's words. */
export function promptOutcome(resultCode: number | null, resultDesc: string | null): string {
  switch (resultCode) {
    case 1032:
      return "The prompt was cancelled on the phone.";
    case 1037:
      return "The prompt timed out before a PIN was entered.";
    case 1:
      return "There wasn't enough in the M-Pesa account.";
    case 2001:
      return "The M-Pesa PIN was wrong.";
    case 1019:
      return "The prompt expired.";
    default:
      return resultDesc ? `M-Pesa said: ${resultDesc}` : "The prompt didn't go through.";
  }
}
