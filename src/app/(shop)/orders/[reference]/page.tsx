import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderBadge } from "@/components/order-badge";
import { PromptWatcher } from "@/components/prompt-watcher";
import { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth/current-user";
import { OrderDelivery } from "@/components/order-delivery";
import { formatTime } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { latestPrompt, promptOutcome } from "@/lib/payments/stk";
import { formatPhone } from "@/lib/phone";
import { getOrder } from "@/lib/shop/orders";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params }: PageProps<"/orders/[reference]">) {
  const { reference } = await params;
  const user = await requireUser(`/orders/${reference}`);

  // Scoped to the buyer: a six-character reference is short enough to guess at,
  // so it must not be the only thing between a stranger and somebody's order.
  const order = await getOrder(reference, user.id);
  if (!order) notFound();

  const prompt =
    order.status === OrderStatus.AWAITING_PAYMENT ? await latestPrompt(order.id) : null;
  const waiting = prompt?.status === PaymentStatus.PENDING;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <nav
        aria-label="Back"
        className="flex items-baseline justify-between gap-4 text-sm text-neutral-500 dark:text-neutral-400"
      >
        <Link href="/" className="underline-offset-4 hover:underline">
          ← Back to the shop
        </Link>
        <Link href="/orders" className="underline-offset-4 hover:underline">
          All your orders
        </Link>
      </nav>

      <div className="mt-6 flex items-baseline justify-between gap-4">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{order.reference}</h1>
        <OrderBadge
          status={order.status}
          lapsed={order.status === OrderStatus.AWAITING_PAYMENT && !order.heldUntil && !waiting}
        />
      </div>

      <StatusExplanation order={order} prompt={prompt} />

      <ul className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-4">
            {item.product.images[0] ? (
              <Image
                src={item.product.images[0].url}
                alt={item.product.images[0].alt ?? item.title}
                width={item.product.images[0].width}
                height={item.product.images[0].height}
                sizes="64px"
                className="aspect-3/4 w-16 rounded-lg bg-neutral-100 object-cover dark:bg-neutral-900"
              />
            ) : (
              <div className="aspect-3/4 w-16 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
            )}

            <div className="min-w-0 flex-1">
              <Link href={`/products/${item.product.slug}`} className="font-medium hover:underline">
                {item.title}
              </Link>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {[item.swatch, item.size].filter(Boolean).join(" · ")}
                {item.quantity > 1 && ` · ×${item.quantity}`}
              </p>
            </div>

            <span className="font-medium">{formatPrice(item.priceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      {order.fulfilment && (
        <div className="mt-4 flex justify-between text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            {order.fulfilment === "PICKUP" ? "Pickup" : `Delivery to ${order.deliveryArea}`}
          </span>
          <span>{order.deliveryFeeCents === 0 ? "Free" : formatPrice(order.deliveryFeeCents)}</span>
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-medium">Total</span>
        <span className="text-xl font-semibold">{formatPrice(order.totalCents)}</span>
      </div>

      {order.fulfilment && (
        <div className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <OrderDelivery order={order} />
        </div>
      )}

      {order.mpesaCode && (
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          M-Pesa code <span className="font-mono">{order.mpesaCode}</span>
        </p>
      )}
    </main>
  );
}

/**
 * What is actually happening, in plain words.
 *
 * The honest version matters here: a buyer who has sent money and sees only a
 * status chip will assume something is wrong. Saying that a person is checking
 * their messages sets the right expectation about how long it takes.
 */
function StatusExplanation({
  order,
  prompt,
}: {
  order: {
    status: OrderStatus;
    reviewNote: string | null;
    reference: string;
    heldUntil: Date | null;
    payments: { refundNote: string | null }[];
  };
  prompt: Prompt | null;
}) {
  if (order.status === OrderStatus.AWAITING_PAYMENT) {
    return prompt?.status === PaymentStatus.PENDING ? (
      <CheckYourPhone reference={order.reference} prompt={prompt} />
    ) : (
      <Unpaid
        heldUntil={order.heldUntil}
        failed={prompt?.status === PaymentStatus.FAILED ? prompt : null}
      />
    );
  }

  const message = {
    [OrderStatus.PENDING_CONFIRMATION]:
      "We have your code and are checking it against the payment. Your pieces stay held until we do — usually within a day.",
    [OrderStatus.CONFIRMED]:
      "Paid and confirmed. We will be in touch about collection or delivery.",
    [OrderStatus.REJECTED]:
      "We could not match that payment, so the pieces have gone back on the rail.",
    [OrderStatus.CANCELLED]:
      "Your hold ran out before this order was paid for, so we closed it. Nothing was charged.",
    [OrderStatus.NEEDS_REFUND]: `Your payment arrived, but some of your pieces sold before it was confirmed, so we can't fill this order. We'll send the full amount back to your M-Pesa. If you haven't heard from us within a day, message us quoting ${order.reference}.`,
    [OrderStatus.REFUNDED]: "We've sent your payment back.",
    // Handled above, by Unpaid.
    [OrderStatus.AWAITING_PAYMENT]: "",
  }[order.status];
  const refund = order.payments.find((payment) => payment.refundNote)?.refundNote;

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
      <p>{message}</p>
      {order.reviewNote && order.status === OrderStatus.REJECTED && (
        <p className="mt-2 text-neutral-500 dark:text-neutral-500">{order.reviewNote}</p>
      )}
      {refund && order.status === OrderStatus.REFUNDED && (
        <p className="mt-2 text-neutral-500 dark:text-neutral-500">{refund}</p>
      )}
    </div>
  );
}

/**
 * Not paid yet: either still held, with the time it runs out, or not.
 *
 * Once the hold has run out the pieces are back on sale, and a code sent for
 * this order would be refused. So the page says so before anyone pays, and
 * offers the way forward: checkout again, which holds whatever is still free.
 */
function Unpaid({ heldUntil, failed }: { heldUntil: Date | null; failed: Prompt | null }) {
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
      {failed && (
        <p role="alert" className="mb-2 font-medium text-neutral-900 dark:text-neutral-100">
          {promptOutcome(failed.resultCode, failed.resultDesc)} Nothing was charged.
        </p>
      )}
      {heldUntil ? (
        <p>
          Your pieces are held until{" "}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {formatTime(heldUntil)}
          </span>
          . Pay by M-Pesa and send us the confirmation code at checkout to finish.
        </p>
      ) : (
        <p>
          Your hold ran out before this order was paid for, so these pieces went back on sale.
          Nothing was charged. Don&rsquo;t pay for this order: check out again, and we&rsquo;ll hold
          whatever is still free.
        </p>
      )}
      <Link
        href="/checkout"
        className="mt-4 inline-block rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {heldUntil ? (failed ? "Try again" : "Back to checkout") : "Check out again"}
      </Link>
    </div>
  );
}

type Prompt = NonNullable<Awaited<ReturnType<typeof latestPrompt>>>;

/**
 * An M-Pesa prompt is out: the buyer's next step is on their phone. Says which
 * phone and how much, so a prompt for the wrong amount or to the wrong number is
 * caught before the PIN, and waits for the answer.
 */
function CheckYourPhone({ reference, prompt }: { reference: string; prompt: Prompt }) {
  return (
    <div className="mt-4 rounded-xl border border-neutral-900 p-4 text-sm dark:border-neutral-100">
      <p className="font-medium">Check your phone</p>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">
        We&rsquo;ve sent an M-Pesa prompt for{" "}
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {formatPrice(prompt.amountCents)}
        </span>
        {prompt.phone && (
          <>
            {" "}
            to <span className="tabular-nums">{formatPhone(prompt.phone)}</span>
          </>
        )}
        . Enter your M-Pesa PIN to pay. Your pieces stay held while you do.
      </p>
      <PromptWatcher reference={reference} />
      <noscript>
        <p className="mt-3 text-xs">Reload this page once you&rsquo;ve entered your PIN.</p>
      </noscript>
    </div>
  );
}
