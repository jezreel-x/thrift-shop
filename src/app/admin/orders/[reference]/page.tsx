import { AlertTriangle, ArrowLeft, MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderDecision } from "@/components/admin/order-decision";
import { OrderStatusBadge } from "@/components/admin/order-status-badge";
import { OrderStatus, Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { getOrderForReview } from "@/lib/admin/orders";
import { can } from "@/lib/admin/permissions";
import { formatDateTime } from "@/lib/dates";
import { OrderDelivery } from "@/components/order-delivery";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { firstName, whatsAppLink } from "@/lib/whatsapp";

type Props = PageProps<"/admin/orders/[reference]">;

export const generateMetadata = staffTitle<Props>(
  async ({ params }) => `Order ${(await params).reference.toUpperCase()}`,
  Permission.ORDERS_VIEW,
);

const REFERENCE = /^TP-[A-Z0-9]{6}$/;

export default async function AdminOrderPage({ params }: Props) {
  const { reference } = await params;
  const { access } = await requirePermission(
    Permission.ORDERS_VIEW,
    `/admin/orders/${encodeURIComponent(reference)}`,
  );

  if (!REFERENCE.test(reference.toUpperCase())) notFound();
  const order = await getOrderForReview(reference);
  if (!order) notFound();

  const pending = order.status === OrderStatus.PENDING_CONFIRMATION;
  const now = new Date();
  const items = order.items.map((item) => ({
    ...item,
    heldForBuyer: item.holdExpiresAt !== null && item.holdExpiresAt > now,
  }));
  const lapsed = pending ? items.filter((item) => !item.heldForBuyer) : [];
  const total = formatPrice(order.totalCents);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Orders
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{order.reference}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="mt-1 text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {order.mpesaCode && (
            <section
              aria-labelledby="payment"
              className="rounded-xl border border-border bg-surface p-5"
            >
              <h2
                id="payment"
                className="text-[11px] font-medium tracking-wider text-muted uppercase"
              >
                {pending ? "Find this payment in your own M-Pesa records" : "Payment"}
              </h2>
              <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted">Code</dt>
                  <dd className="mt-0.5 font-mono text-xl font-semibold tracking-wider select-all">
                    {order.mpesaCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Amount</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums">{total}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Claimed</dt>
                  <dd className="mt-0.5 text-sm">
                    {order.claimedAt ? formatDateTime(order.claimedAt) : "—"}
                  </dd>
                </div>
              </dl>
              {pending && (
                <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
                  Check it yourself: the SMS from <span className="font-mono">MPESA</span>, your
                  M-Pesa app, or your statement. Never rely on a screenshot or a message the buyer
                  forwards. Both are easy to fake, and a fake one can come from an ordinary number
                  made to look like M-Pesa.
                </p>
              )}
            </section>
          )}

          {lapsed.length > 0 && (
            <p
              role="alert"
              className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                The hold on {lapsed.map((item) => item.title).join(", ")} has run out, so it may
                have gone to another buyer. This order can&apos;t be confirmed. If the money
                arrived, contact the buyer about a refund, then reject it.
              </span>
            </p>
          )}

          {pending &&
            (can(access, Permission.ORDERS_CONFIRM_PAYMENT) ? (
              <section aria-label="Decision">
                <OrderDecision orderId={order.id} total={total} canConfirm={lapsed.length === 0} />
              </section>
            ) : (
              <p className="rounded-xl border border-border p-4 text-sm text-muted">
                Your role can see orders but not confirm payments. Someone who can will decide this
                one.
              </p>
            ))}

          <section aria-labelledby="items">
            <h2 id="items" className="text-[11px] font-medium tracking-wider text-muted uppercase">
              Items
            </h2>
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {items.map((item) => {
                const image = item.product.images[0];

                return (
                  <li key={item.id} className="flex items-center gap-4 p-4">
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                      {image && (
                        <Image
                          src={image.url}
                          alt={image.alt ?? item.title}
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${item.product.slug}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="text-sm text-muted">
                        {[item.swatch, item.size && `Size ${item.size}`]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.quantity > 1 && ` · ×${item.quantity}`}
                        {pending && (
                          <>
                            {" · "}
                            {item.heldForBuyer && item.holdExpiresAt ? (
                              <>Held until {formatDateTime(item.holdExpiresAt)}</>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300">
                                Hold ran out
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <p className="tabular-nums">{formatPrice(item.priceCents * item.quantity)}</p>
                  </li>
                );
              })}
              {order.fulfilment && (
                <li className="flex justify-between p-4 text-sm">
                  <span className="text-muted">
                    {order.fulfilment === "PICKUP" ? "Pickup" : `Delivery to ${order.deliveryArea}`}
                  </span>
                  <span className="tabular-nums">
                    {order.deliveryFeeCents === 0 ? "Free" : formatPrice(order.deliveryFeeCents)}
                  </span>
                </li>
              )}
              <li className="flex justify-between p-4 font-medium">
                <span>Total</span>
                <span className="tabular-nums">{total}</span>
              </li>
            </ul>
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section aria-labelledby="buyer">
            <h2 id="buyer" className="text-[11px] font-medium tracking-wider text-muted uppercase">
              Buyer
            </h2>
            <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm">
              <p className="font-medium">{order.buyerName}</p>
              <p className="mt-1 tabular-nums select-all">{formatPhone(order.buyerPhone)}</p>
              <p className="mt-1 break-all text-muted">{order.user.email}</p>
              <a
                href={whatsAppLink(order.buyerPhone, buyerMessage(order, total))}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 font-medium transition hover:bg-surface-muted"
              >
                <MessageCircle aria-hidden className="size-4" />
                Message on WhatsApp
              </a>
              <p className="mt-2 text-xs text-muted">
                Opens a chat with a message ready to edit. Nothing is sent until you press send.
              </p>
            </div>
          </section>

          {order.fulfilment && (
            <section aria-labelledby="delivery">
              <h2
                id="delivery"
                className="text-[11px] font-medium tracking-wider text-muted uppercase"
              >
                {order.fulfilment === "PICKUP" ? "Pickup" : "Delivery"}
              </h2>
              <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm">
                <OrderDelivery order={order} mutedClassName="text-muted" />
              </div>
            </section>
          )}

          <section aria-labelledby="history">
            <h2
              id="history"
              className="text-[11px] font-medium tracking-wider text-muted uppercase"
            >
              History
            </h2>
            <ol className="mt-3 flex flex-col gap-3 border-l border-border pl-4 text-sm">
              <Event when={order.createdAt}>Order placed</Event>
              {order.claimedAt && (
                <Event when={order.claimedAt}>Buyer said they paid ({order.mpesaCode})</Event>
              )}
              {order.history.map((entry) => (
                <Event key={entry.id} when={entry.createdAt}>
                  {describe(entry.action)} by{" "}
                  {entry.actor?.name ?? entry.actor?.email ?? "a script"}
                  {detail(entry.after) && (
                    <span className="block text-muted">{detail(entry.after)}</span>
                  )}
                </Event>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Event({ when, children }: { when: Date; children: React.ReactNode }) {
  return (
    <li className="relative">
      <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-border" />
      <p>{children}</p>
      <p className="text-xs text-muted">{formatDateTime(when)}</p>
    </li>
  );
}

function describe(action: string): string {
  if (action === "order.confirm-payment") return "Payment confirmed";
  if (action === "order.reject-payment") return "Payment rejected";
  return action;
}

/** The note or reason recorded with a decision, if there was one. */
function detail(after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const { note, reason } = after as { note?: unknown; reason?: unknown };
  const text = typeof reason === "string" ? reason : typeof note === "string" ? note : null;

  return text ? `“${text}”` : null;
}

/** What to say to the buyer, given where the order stands. Edited before sending. */
function buyerMessage(
  order: {
    status: OrderStatus;
    reference: string;
    buyerName: string;
    mpesaCode: string | null;
    reviewNote: string | null;
  },
  total: string,
): string {
  const hi = `Hi ${firstName(order.buyerName)}, this is The Thrift Plug about order ${order.reference}.`;

  switch (order.status) {
    case OrderStatus.PENDING_CONFIRMATION:
      return `${hi} We're checking your M-Pesa payment (${order.mpesaCode}) and will confirm shortly.`;
    case OrderStatus.CONFIRMED:
      return `${hi} Your payment of ${total} is confirmed. Thank you! We'll be in touch about delivery.`;
    case OrderStatus.REJECTED:
      return `${hi} We couldn't confirm your M-Pesa payment: ${order.reviewNote ?? ""} Reply here and we'll sort it out.`;
    default:
      return `${hi} `;
  }
}
