import type { Metadata } from "next";
import Link from "next/link";

import { OrderBadge } from "@/components/order-badge";

import { requireUser } from "@/lib/auth/current-user";
import { formatPrice } from "@/lib/money";
import { listOrders } from "@/lib/orders";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

export default async function OrdersPage() {
  const user = await requireUser("/orders");
  const orders = await listOrders(user.id);

  if (orders.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No orders yet</h1>
        <Link
          href="/"
          className="mt-8 rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Browse the rail
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>

      <ul className="mt-8 space-y-3">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/orders/${order.reference}`}
              className="block rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono font-medium">{order.reference}</span>
                <OrderBadge status={order.status} />
              </div>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                {order.items.length} {order.items.length === 1 ? "piece" : "pieces"} ·{" "}
                {formatPrice(order.totalCents)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
