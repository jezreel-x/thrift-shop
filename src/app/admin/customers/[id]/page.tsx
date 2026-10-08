import { ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusBadge } from "@/components/admin/order-status-badge";
import { Fulfilment, Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { getCustomer } from "@/lib/admin/customers";
import { staffTitle } from "@/lib/admin/metadata";
import { can } from "@/lib/admin/permissions";
import { formatAge, formatDate, formatDateTime } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { firstName, whatsAppLink } from "@/lib/whatsapp";

type Props = PageProps<"/admin/customers/[id]">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });

  return user?.name ?? "Customer";
}, Permission.CUSTOMERS_VIEW);

export default async function CustomerPage({ params }: Props) {
  const { id } = await params;
  const { access } = await requirePermission(Permission.CUSTOMERS_VIEW, `/admin/customers/${id}`);

  const customer = await getCustomer(id);
  if (!customer) notFound();

  // Order pages need their own permission; without it the references are text.
  const canSeeOrders = can(access, Permission.ORDERS_VIEW);
  const { delivery, stats } = customer;

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Customers
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {customer.name ?? "No name given"}
        </h1>
        {customer.isStaff && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">
            Staff
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">Customer since {formatDate(customer.joinedAt)}</p>

      <dl className="mt-6 grid grid-cols-3 gap-3 sm:max-w-xl">
        <Stat label="Orders" value={String(stats.orders)} />
        <Stat label="Spent" value={formatPrice(stats.spentCents)} />
        <Stat
          label="Last order"
          value={stats.lastOrderAt ? formatAge(stats.lastOrderAt) : "Never"}
          title={stats.lastOrderAt ? formatDateTime(stats.lastOrderAt) : undefined}
        />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="orders">
          <h2 id="orders" className="text-[11px] font-medium tracking-wider text-muted uppercase">
            Orders
          </h2>
          {customer.orders.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No orders yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {customer.orders.map((order) => (
                <li key={order.reference} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="min-w-0 flex-1">
                    {canSeeOrders ? (
                      <Link
                        href={`/admin/orders/${order.reference}`}
                        className="font-mono text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {order.reference}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm font-medium">{order.reference}</span>
                    )}
                    <span className="block text-xs text-muted">
                      <span title={formatDateTime(order.createdAt)}>
                        {formatDate(order.createdAt)}
                      </span>{" "}
                      · {order.items === 1 ? "1 item" : `${order.items} items`}
                    </span>
                  </span>
                  <OrderStatusBadge status={order.status} />
                  <span className="w-24 text-right text-sm tabular-nums">
                    {formatPrice(order.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-8">
          <section aria-labelledby="contact">
            <h2
              id="contact"
              className="text-[11px] font-medium tracking-wider text-muted uppercase"
            >
              Contact
            </h2>
            <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm">
              {customer.phone ? (
                <p className="tabular-nums select-all">{formatPhone(customer.phone)}</p>
              ) : (
                <p className="text-muted">No phone yet: it&apos;s asked at their first checkout.</p>
              )}
              <p className="mt-1 break-all text-muted select-all">{customer.email}</p>
              {customer.phone && (
                <>
                  <a
                    href={whatsAppLink(customer.phone, `Hi ${firstName(customer.name ?? "")}, `)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 font-medium transition hover:bg-surface-muted"
                  >
                    <MessageCircle aria-hidden className="size-4" />
                    Message on WhatsApp
                  </a>
                  <p className="mt-2 text-xs text-muted">
                    Opens a chat. Nothing is sent until you press send.
                  </p>
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="delivery">
            <h2
              id="delivery"
              className="text-[11px] font-medium tracking-wider text-muted uppercase"
            >
              Delivery, as last chosen
            </h2>
            <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm">
              {delivery.fulfilment === Fulfilment.PICKUP ? (
                <p>Collects from the shop</p>
              ) : delivery.fulfilment === Fulfilment.DELIVERY ? (
                <>
                  <p className="font-medium">{delivery.area ?? "An area no longer offered"}</p>
                  {delivery.address && <p className="text-muted">{delivery.address}</p>}
                  {delivery.phone && (
                    <p className="text-muted">
                      Rider calls{" "}
                      <span className="tabular-nums">{formatPhone(delivery.phone)}</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted">Not chosen yet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-[11px] font-medium tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  );
}
