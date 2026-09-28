import { OrderStatus } from "@/generated/prisma/enums";

/**
 * The buyer's view of where an order stands.
 *
 * Deliberately plain about the one state that matters: waiting on a person to
 * read their M-Pesa messages. Dressing that up as "processing" would imply a
 * machine is working on it, and set the wrong expectation about how long it
 * takes.
 */
export function OrderBadge({ status }: { status: OrderStatus }) {
  const { label, className } = ORDER_BADGES[status];

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium tracking-wide uppercase ${className}`}
    >
      {label}
    </span>
  );
}

const ORDER_BADGES: Record<OrderStatus, { label: string; className: string }> = {
  [OrderStatus.AWAITING_PAYMENT]: {
    label: "Awaiting payment",
    className: "bg-amber-500 text-neutral-950",
  },
  [OrderStatus.PENDING_CONFIRMATION]: {
    label: "Checking payment",
    className: "bg-blue-500 text-white",
  },
  [OrderStatus.CONFIRMED]: { label: "Confirmed", className: "bg-green-600 text-white" },
  [OrderStatus.REJECTED]: { label: "Not confirmed", className: "bg-red-600 text-white" },
  [OrderStatus.CANCELLED]: {
    label: "Cancelled",
    className: "bg-neutral-300 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200",
  },
};
