import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ContactForm } from "@/components/contact-form";
import { PaymentClaimForm } from "@/components/payment-claim-form";
import { PaymentMethod } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth/current-user";
import { readCartId } from "@/lib/shop/cart-session";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { beginCheckout } from "@/lib/shop/orders";
import { prisma } from "@/lib/prisma";
import {
  PAYMENT_INSTRUCTIONS,
  PAYMENT_NUMBER_LABELS,
  type PaymentDetails,
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
 * finds the same order and extends the same holds rather than opening a second.
 */
export default async function CheckoutPage() {
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

  const result = await beginCheckout(user.id, cartId, {
    name: user.name ?? user.email,
    phone: user.phone,
  });

  if (!result.ok) redirect("/cart");

  const payment = await getPaymentDetails();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Held for you for {RESERVATION_MINUTES} minutes. Order{" "}
        <span className="font-mono font-medium">{result.reference}</span>.
      </p>

      {result.droppedTitles.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {result.droppedTitles.length === 1
            ? `${result.droppedTitles[0]} was taken before you got here and is not included.`
            : `${result.droppedTitles.join(", ")} were taken before you got here and are not included.`}
        </p>
      )}

      <OrderSummary orderId={result.orderId} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Pay by M-Pesa</h2>

        {payment ? (
          <PaymentInstructions payment={payment} reference={result.reference} />
        ) : (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Payment details have not been set up yet, so this order cannot be paid for online. Your
            pieces stay held for {RESERVATION_MINUTES} minutes.
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
          <PaymentClaimForm orderId={result.orderId} />
        </section>
      )}

      <Link
        href="/cart"
        className="mt-8 block text-center text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        Back to your cart
      </Link>
    </main>
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
                {item.size}
              </span>
            </span>
            <span className="font-medium">{formatPrice(item.priceCents)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-medium">Total</span>
        <span className="text-xl font-semibold">{formatPrice(order.totalCents)}</span>
      </div>
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
