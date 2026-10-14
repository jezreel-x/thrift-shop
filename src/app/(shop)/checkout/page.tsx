import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ContactForm } from "@/components/contact-form";
import { DeliveryForm } from "@/components/delivery-form";
import { OrderDelivery } from "@/components/order-delivery";
import { PaymentClaimForm } from "@/components/payment-claim-form";
import { PromptForm } from "@/components/prompt-form";
import { WhileHeld } from "@/components/while-held";
import { PaymentMethod } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth/current-user";
import { formatTime } from "@/lib/dates";
import { promptsOffered } from "@/lib/payments/stk";
import { readCartId } from "@/lib/shop/cart-session";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { offersChoice, rememberedChoice } from "@/lib/shop/delivery";
import { beginCheckout } from "@/lib/shop/orders";
import { prisma } from "@/lib/prisma";
import {
  PAYMENT_INSTRUCTIONS,
  PAYMENT_NUMBER_LABELS,
  type PaymentDetails,
  getDeliveryOptions,
  getPaymentDetails,
} from "@/lib/shop/settings";
import { RESERVATION_MINUTES } from "@/lib/shop/reservations";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * Loading this page is not passive: it reserves everything in the cart that can
 * still be held, which is the moment a shortlist becomes a claim. Re-entering
 * while held finds the same order and the same holds, with the same deadline,
 * rather than opening a second; once the holds have run out, it starts a new
 * order.
 */
export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  // The first point in the shop that requires an account: a reservation has to
  // belong to somebody, and an order settled by hand needs a person to contact.
  const user = await requireUser("/checkout");

  const cartId = await readCartId();
  if (!cartId) redirect("/cart");

  // Asked before anything is reserved, so the fifteen-minute hold is not spent
  // typing. A shop that confirms payments by reading M-Pesa messages and
  // arranges delivery over WhatsApp cannot fulfil an order without a number.
  if (!user.phone) {
    return (
      <main className="mx-auto w-full max-w-sm flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
        <p className="mt-2 mb-8 text-sm text-neutral-600 dark:text-neutral-400">
          We ask once, and remember it for next time.
        </p>
        <ContactForm name={user.name} />
      </main>
    );
  }

  // Then how it reaches them, for the same reason: asked before the hold
  // starts, remembered for next time. Only when the shop offers a choice.
  const [options, remembered, query] = await Promise.all([
    getDeliveryOptions(),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        fulfilment: true,
        deliveryAreaId: true,
        deliveryAddress: true,
        deliveryPhone: true,
      },
    }),
    searchParams,
  ]);
  const changing = query.change === "delivery";
  const delivery = offersChoice(options) ? rememberedChoice(remembered, options) : null;

  if (offersChoice(options) && (!delivery || changing)) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Pickup or delivery</h1>
        <p className="mt-2 mb-8 text-sm text-neutral-600 dark:text-neutral-400">
          We remember it for next time.
        </p>
        <DeliveryForm
          options={options}
          initial={{
            fulfilment: remembered.fulfilment ?? "",
            area: remembered.deliveryAreaId ?? "",
            address: remembered.deliveryAddress ?? "",
            phone: formatPhone(remembered.deliveryPhone ?? user.phone),
          }}
        />
        {delivery && (
          <Link
            href="/checkout"
            className="mt-6 block text-center text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
          >
            Keep what I had
          </Link>
        )}
      </main>
    );
  }

  const result = await beginCheckout(
    user.id,
    cartId,
    { name: user.name ?? user.email, phone: user.phone },
    delivery,
  );

  // A prompt is out for this order: its page waits for it to end.
  if (!result.ok && result.reason === "prompt-pending") redirect(`/orders/${result.reference}`);
  if (!result.ok) redirect("/cart");

  const [payment, { totalCents }] = await Promise.all([
    getPaymentDetails(),
    prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { totalCents: true },
    }),
  ]);
  const heldUntil = formatTime(result.heldUntil);
  // Whole shillings only: Daraja takes no cents, and a total is never rounded.
  const prompt = promptsOffered(payment) && totalCents % 100 === 0;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Held for you until{" "}
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{heldUntil}</span> (
        {RESERVATION_MINUTES} minutes). Order{" "}
        <span className="font-mono font-medium">{result.reference}</span>.
      </p>

      {result.droppedTitles.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {result.droppedTitles.length === 1
            ? `${result.droppedTitles[0]} was taken before you got here and is not included.`
            : `${result.droppedTitles.join(", ")} were taken before you got here and are not included.`}
        </p>
      )}

      {result.reduced.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {result.reduced
            .map(
              (line) =>
                `Only ${line.held} of the ${line.requested} ${line.title} you wanted were free`,
            )
            .join(". ")}
          . The order below is for what we could hold.
        </p>
      )}

      <OrderSummary orderId={result.orderId} />

      {/* Keyed by the time, so checking out again starts a fresh countdown. */}
      <WhileHeld
        key={result.heldUntil.toISOString()}
        until={result.heldUntil.toISOString()}
        untilLabel={heldUntil}
      >
        {prompt && payment ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">How will you pay?</h2>

            <div className="mt-4 rounded-xl border border-neutral-900 p-4 dark:border-neutral-100">
              <h3 className="font-medium">M-Pesa prompt to your phone</h3>
              <p className="mt-1 mb-4 text-sm text-neutral-600 dark:text-neutral-400">
                The prompt names who you&rsquo;re paying. If it isn&rsquo;t{" "}
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {payment.name}
                </span>
                , don&rsquo;t enter your PIN.
              </p>
              <PromptForm
                orderId={result.orderId}
                phone={formatPhone(user.phone)}
                total={formatPrice(totalCents)}
              />
            </div>

            {/* The fallback, for a prompt that won't come or a buyer who'd rather. */}
            <details className="group mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <summary className="cursor-pointer text-sm font-medium select-none">
                Or pay our {PAYMENT_NOUN[payment.method]} yourself, then enter the code
              </summary>
              <PaymentInstructions payment={payment} reference={result.reference} />
              <p className="mt-6 mb-4 text-sm text-neutral-600 dark:text-neutral-400">
                Then paste the code from your M-Pesa message. We check it against the payment and
                confirm — your pieces stay held while we do.
              </p>
              <PaymentClaimForm orderId={result.orderId} />
            </details>
          </section>
        ) : (
          <ManualPayment
            payment={payment}
            reference={result.reference}
            orderId={result.orderId}
            heldUntil={heldUntil}
          />
        )}
      </WhileHeld>

      <Link
        href="/cart"
        className="mt-8 block text-center text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        Back to your cart
      </Link>
    </main>
  );
}

const PAYMENT_NOUN: Record<PaymentMethod, string> = {
  [PaymentMethod.TILL]: "till",
  [PaymentMethod.PAYBILL]: "paybill",
  [PaymentMethod.POCHI]: "number",
};

/** Paying the till by hand and typing the code: the only way when prompts aren't offered. */
function ManualPayment({
  payment,
  reference,
  orderId,
  heldUntil,
}: {
  payment: PaymentDetails | null;
  reference: string;
  orderId: string;
  heldUntil: string;
}) {
  return (
    <>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Pay by M-Pesa</h2>

        {payment ? (
          <PaymentInstructions payment={payment} reference={reference} />
        ) : (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Payment details have not been set up yet, so this order cannot be paid for online. Your
            pieces stay held until {heldUntil}.
          </p>
        )}
      </section>

      {payment && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Then tell us</h2>
          <p className="mt-2 mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            Paste the code from your M-Pesa message. We check it against the payment and confirm —
            your pieces stay held while we do.
          </p>
          <PaymentClaimForm orderId={orderId} />
        </section>
      )}
    </>
  );
}

async function OrderSummary({ orderId }: { orderId: string }) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });

  return (
    <section className="mt-8">
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-4 py-3">
            <span>
              {item.title}
              <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">
                {[item.swatch, item.size].filter(Boolean).join(" · ")}
                {item.quantity > 1 && ` · ×${item.quantity}`}
              </span>
            </span>
            <span className="font-medium">{formatPrice(item.priceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      {order.fulfilment && (
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Items</dt>
            <dd>{formatPrice(order.totalCents - order.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">
              {order.fulfilment === "PICKUP" ? "Pickup" : `Delivery to ${order.deliveryArea}`}
            </dt>
            <dd>{order.deliveryFeeCents === 0 ? "Free" : formatPrice(order.deliveryFeeCents)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-medium">Total</span>
        <span className="text-xl font-semibold">{formatPrice(order.totalCents)}</span>
      </div>

      {order.fulfilment && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <OrderDelivery order={order} />
          <Link
            href="/checkout?change=delivery"
            className="shrink-0 text-sm underline underline-offset-4"
          >
            Change
          </Link>
        </div>
      )}
    </section>
  );
}

function PaymentInstructions({
  payment,
  reference,
}: {
  payment: PaymentDetails;
  reference: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {PAYMENT_INSTRUCTIONS[payment.method]}
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <Row
          label={PAYMENT_NUMBER_LABELS[payment.method]}
          value={
            payment.method === PaymentMethod.POCHI ? formatPhone(payment.number) : payment.number
          }
        />
        {payment.accountNumber && <Row label="Account number" value={payment.accountNumber} />}
        <Row label="M-Pesa will show" value={payment.name} />
      </dl>

      {/*
        The one check a buyer can do themselves. A copycat page can copy the
        photos and prices, but not the name registered to the till.
      */}
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Before you enter your PIN, M-Pesa shows the name you are paying. If it is not{" "}
        <span className="font-semibold">{payment.name}</span>, stop and contact us.
      </p>

      <p className="mt-4 border-t border-neutral-200 pt-3 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
        Quote <span className="font-mono font-medium">{reference}</span> if you message about this
        order.
      </p>

      {payment.note && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{payment.note}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="font-mono text-base font-semibold">{value}</dd>
    </div>
  );
}
