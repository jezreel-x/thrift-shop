import { describe, expect, it } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
import { confirmOrder } from "@/lib/admin/orders";
import { addToCart, resolveCart } from "@/lib/shop/cart";
import { beginCheckout, claimPayment } from "@/lib/shop/orders";
import { reserveVariant } from "@/lib/shop/reservations";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";

cleanDatabaseBetweenTests();

let run = 0;

/** A paid-for order on the last unit, whose hold has lapsed. */
async function lapsedClaimOnTheLastUnit() {
  run += 1;
  const product = await makeProduct({}, { stock: 1 });
  const buyer = await db.user.create({
    // Never signs in: no need to pay for argon2, which is slow on purpose.
    data: { email: `buyer-${run}@example.com`, passwordHash: "not used" },
  });
  const cart = await resolveCart({ userId: buyer.id });
  await addToCart(cart.id, product.variantId);
  const checkout = await beginCheckout(buyer.id, cart.id, {
    name: "Grace",
    phone: "254712345678",
  });
  if (!checkout.ok) throw new Error("checkout failed");
  await claimPayment(checkout.orderId, buyer.id, `SGH7XKL${String(run).padStart(3, "0")}`);
  await db.stockHold.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

  const staff = await db.user.create({
    data: { email: `staff-${run}@example.com`, passwordHash: "not used" },
  });

  return { product, orderId: checkout.orderId, staffId: staff.id };
}

describe("settling a late payment", () => {
  it("never lets a late payment and a new buyer both have the last unit", async () => {
    // Raced repeatedly: whichever gets the variant's lock first wins, and the
    // other sees the unit gone. The one outcome that must never happen is both.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { product, orderId, staffId } = await lapsedClaimOnTheLastUnit();

      const [settled, reserved] = await Promise.all([
        confirmOrder({ orderId, actorId: staffId }),
        reserveVariant(product.variantId, `new-buyer-${attempt}`),
      ]);

      const sold = settled.ok && settled.outcome === "confirmed";
      expect(
        sold !== reserved.ok,
        `attempt ${attempt}: sold ${sold}, reserved ${reserved.ok}`,
      ).toBe(true);

      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      const variant = await db.productVariant.findUniqueOrThrow({
        where: { id: product.variantId },
      });
      if (sold) {
        expect(order.status).toBe(OrderStatus.CONFIRMED);
        expect(variant.stock).toBe(0);
      } else {
        expect(order.status).toBe(OrderStatus.NEEDS_REFUND);
        expect(variant.stock).toBe(1);
      }
    }
  }, 30_000);
});
