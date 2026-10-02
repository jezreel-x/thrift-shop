import { Search } from "lucide-react";
import Link from "next/link";

import { OrderStatusBadge } from "@/components/admin/order-status-badge";
import { OrderStatus, Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { ORDER_TABS, orderQueueHref, parseOrderQuery } from "@/lib/admin/order-query";
import { countOrdersByStatus, listOrdersForReview } from "@/lib/admin/orders";
import { formatAge, formatDateTime } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

export const generateMetadata = staffTitle("Orders", Permission.ORDERS_VIEW);

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requirePermission(Permission.ORDERS_VIEW, "/admin/orders");

  const query = parseOrderQuery(await searchParams);
  const [counts, { orders, total, pageCount }] = await Promise.all([
    countOrdersByStatus(),
    listOrdersForReview({ status: query.tab.status, search: query.search, page: query.page }),
  ]);
  const toConfirm = query.tab.status === OrderStatus.PENDING_CONFIRMATION;

  return (
    <main className="mx-auto w-full max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <p className="mt-1 text-sm text-muted">
        Find each claimed payment in your own M-Pesa records, then confirm or reject it. Never rely
        on a screenshot.
      </p>

      <nav aria-label="Order status" className="mt-6 overflow-x-auto">
        <ul className="flex min-w-max gap-1 rounded-xl border border-border bg-surface-muted/50 p-1">
          {ORDER_TABS.map((tab) => {
            const active = tab.slug === query.tab.slug;

            return (
              <li key={tab.slug} className="flex-1">
                <Link
                  href={orderQueueHref({ tab, search: query.search })}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-4 py-2 text-center text-sm whitespace-nowrap transition ${
                    active
                      ? "bg-surface font-medium text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}{" "}
                  <span className="text-muted tabular-nums">({counts[tab.status]})</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* A plain GET form: the search lands in the URL, and works without JavaScript. */}
      <form action="/admin/orders" className="mt-4 flex gap-2">
        {query.tab.slug !== ORDER_TABS[0].slug && (
          <input type="hidden" name="status" value={query.tab.slug} />
        )}
        <label className="relative flex-1 sm:max-w-sm">
          <span className="sr-only">Search orders</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Reference, M-Pesa code, name or phone"
            className="w-full rounded-lg border border-border bg-transparent py-2 pr-3 pl-9 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-border px-4 text-sm transition hover:bg-surface-muted"
        >
          Search
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {orders.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted">
            {query.search
              ? `No ${query.tab.label.toLowerCase()} orders match “${query.search}”.`
              : toConfirm
                ? "Nothing to confirm. New payment claims will appear here."
                : `No ${query.tab.label.toLowerCase()} orders.`}
          </p>
        ) : (
          <>
            {/*
              Cards on a phone, where the owner is most likely checking: she is
              matching codes against M-Pesa messages on the same handset.
            */}
            <ul className="divide-y divide-border md:hidden">
              {orders.map((order) => {
                const when = toConfirm && order.claimedAt ? order.claimedAt : order.createdAt;

                return (
                  <li key={order.id}>
                    <Link
                      href={`/admin/orders/${order.reference}`}
                      className="block p-4 transition hover:bg-surface-muted/50"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-sm font-medium">{order.reference}</span>
                        <span className="text-xs text-muted" title={formatDateTime(when)}>
                          {formatAge(when)}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm">
                        {order.buyerName}{" "}
                        <span className="text-muted tabular-nums">
                          · {formatPhone(order.buyerPhone)}
                        </span>
                      </span>
                      <span className="mt-2 flex items-baseline justify-between gap-3">
                        <span className="font-mono text-sm tracking-wider">
                          {order.mpesaCode ?? <span className="text-muted">No code yet</span>}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatPrice(order.totalCents)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {order.items.map((item) => item.title).join(", ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <table className="hidden w-full min-w-[760px] text-left text-sm md:table">
              <thead className="border-b border-border text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {toConfirm ? "Claimed" : "Placed"}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Buyer
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Items
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    M-Pesa code
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((order) => {
                  const when = toConfirm && order.claimedAt ? order.claimedAt : order.createdAt;

                  return (
                    <tr key={order.id} className="transition hover:bg-surface-muted/50">
                      <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">
                        {order.reference}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span title={formatDateTime(when)}>{formatAge(when)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p>{order.buyerName}</p>
                        <p className="text-xs text-muted tabular-nums">
                          {formatPhone(order.buyerPhone)}
                        </p>
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        <p
                          className="truncate"
                          title={order.items.map((item) => item.title).join(", ")}
                        >
                          {order.items[0]?.title}
                        </p>
                        {order.items.length > 1 && (
                          <p className="text-xs text-muted">and {order.items.length - 1} more</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatPrice(order.totalCents)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tracking-wider">
                        {order.mpesaCode ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/orders/${order.reference}`}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-surface-muted"
                        >
                          {toConfirm ? "Review" : "View"}
                          <span className="sr-only"> order {order.reference}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <p className="tabular-nums">
            {total} {total === 1 ? "order" : "orders"}
          </p>
          {pageCount > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-2">
              <PageLink
                href={orderQueueHref({ ...query, page: query.page - 1 })}
                disabled={query.page <= 1}
              >
                Previous
              </PageLink>
              <span className="tabular-nums">
                Page {Math.min(query.page, pageCount)} of {pageCount}
              </span>
              <PageLink
                href={orderQueueHref({ ...query, page: query.page + 1 })}
                disabled={query.page >= pageCount}
              >
                Next
              </PageLink>
            </nav>
          )}
        </div>
      )}
    </main>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "rounded-md border border-border px-3 py-1.5 text-xs";

  return disabled ? (
    <span aria-disabled="true" className={`${className} opacity-40`}>
      {children}
    </span>
  ) : (
    <Link
      href={href}
      className={`${className} transition hover:bg-surface-muted hover:text-foreground`}
    >
      {children}
    </Link>
  );
}
