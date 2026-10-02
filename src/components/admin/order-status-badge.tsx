import { OrderStatus } from "@/generated/prisma/enums";

/**
 * An order's state, in staff terms.
 *
 * Separate from the buyer's OrderBadge on purpose: the buyer sees "Checking
 * payment", which is true from where they stand; staff see "To confirm",
 * which is the thing they have to do.
 */
const BADGES: Record<OrderStatus, { label: string; className: string }> = {
  [OrderStatus.PENDING_CONFIRMATION]: {
    label: "To confirm",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  },
  [OrderStatus.AWAITING_PAYMENT]: {
    label: "Awaiting payment",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  [OrderStatus.CONFIRMED]: {
    label: "Confirmed",
    className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  [OrderStatus.REJECTED]: {
    label: "Rejected",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
  [OrderStatus.CANCELLED]: {
    label: "Cancelled",
    className: "bg-surface-muted text-muted",
  },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, className } = BADGES[status];

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}
