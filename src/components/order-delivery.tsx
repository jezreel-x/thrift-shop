import { Fulfilment } from "@/generated/prisma/enums";
import { formatPhone } from "@/lib/phone";

/**
 * How an order reaches its buyer, as the order recorded it. The same lines on
 * checkout, the buyer's order page and the staff order page, so all three say
 * the same thing.
 */
export type OrderDeliveryFields = {
  fulfilment: Fulfilment | null;
  pickupAddress: string | null;
  deliveryArea: string | null;
  deliveryAddress: string | null;
  deliveryPhone: string | null;
};

export function OrderDelivery({
  order,
  mutedClassName = "text-neutral-600 dark:text-neutral-400",
}: {
  order: OrderDeliveryFields;
  mutedClassName?: string;
}) {
  if (order.fulfilment === Fulfilment.PICKUP) {
    return (
      <div>
        <p className="font-medium">Collect from the shop</p>
        {order.pickupAddress && (
          <p className={`text-sm ${mutedClassName}`}>{order.pickupAddress}</p>
        )}
      </div>
    );
  }

  if (order.fulfilment === Fulfilment.DELIVERY) {
    return (
      <div>
        <p className="font-medium">Delivery to {order.deliveryArea}</p>
        <p className={`text-sm ${mutedClassName}`}>{order.deliveryAddress}</p>
        {order.deliveryPhone && (
          <p className={`text-sm ${mutedClassName}`}>
            Rider calls <span className="tabular-nums">{formatPhone(order.deliveryPhone)}</span>
          </p>
        )}
      </div>
    );
  }

  return null;
}
