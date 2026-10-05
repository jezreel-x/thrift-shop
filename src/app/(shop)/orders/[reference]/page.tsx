import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderBadge } from "@/components/order-badge";
import { OrderStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth/current-user";
import { formatPrice } from "@/lib/money";
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
        <OrderBadge status={order.status} />
      </div>

      <StatusExplanation order={order} />

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

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-medium">Total</span>
        <span className="text-xl font-semibold">{formatPrice(order.totalCents)}</span>
      </div>

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
}: {
  order: { status: OrderStatus; reviewNote: string | null };
}) {
  const message = {
    [OrderStatus.AWAITING_PAYMENT]:
      "Your pieces are held. Pay by M-Pesa and send us the confirmation code to finish.",
    [OrderStatus.PENDING_CONFIRMATION]:
      "We have your code and are checking it against the payment. Your pieces stay held until we do — usually within a day.",
    [OrderStatus.CONFIRMED]:
      "Paid and confirmed. We will be in touch about collection or delivery.",
    [OrderStatus.REJECTED]:
      "We could not match that payment, so the pieces have gone back on the rail.",
    [OrderStatus.CANCELLED]: "This order was cancelled and nothing was charged.",
  }[order.status];

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
      <p>{message}</p>
      {order.reviewNote && order.status === OrderStatus.REJECTED && (
        <p className="mt-2 text-neutral-500 dark:text-neutral-500">{order.reviewNote}</p>
      )}
    </div>
  );
}
