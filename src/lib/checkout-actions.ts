"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "./auth/current-user";
import { clearCart } from "./cart";
import { readCartId } from "./cart-session";
import { claimPayment } from "./orders";

/**
 * The buyer telling us they have paid.
 *
 * Nothing here verifies anything — see docs, and the comment on claimPayment.
 * In v1 the owner reads her M-Pesa messages; this records what to check against
 * and holds the items while she does.
 */

export type ClaimFormState = { error?: string };

/** Ten characters, letters and digits, as Safaricom issues them. */
const MPESA_CODE = /^[A-Z0-9]{10}$/;

export async function claimPaymentAction(
  _previous: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Fcheckout");

  const orderId = String(formData.get("orderId") ?? "");
  const code = String(formData.get("mpesaCode") ?? "")
    .trim()
    .toUpperCase();

  // A format check catches a typo or a phone number in the wrong box. It cannot
  // catch an invented code — only the owner's SMS can do that, which is why the
  // items stay reserved rather than sold.
  if (!MPESA_CODE.test(code)) {
    return { error: "That does not look like an M-Pesa code. They are 10 letters and digits." };
  }

  const result = await claimPayment(orderId, user.id, code);

  if (!result.ok) {
    return { error: explain(result.reason) };
  }

  // The items are on the order now; leaving them in the cart would invite a
  // second checkout for things already being paid for.
  const cartId = await readCartId();
  if (cartId) await clearCart(cartId);

  revalidatePath("/", "layout");
  redirect("/orders");
}

function explain(reason: string): string {
  switch (reason) {
    case "code-already-used":
      return "That code has already been used on another order. Check your M-Pesa messages for the right one.";
    case "already-claimed":
      return "You have already sent a code for this order. We are checking it.";
    case "hold-lapsed":
      return "Your hold on one of these pieces ran out. Go back to your cart and start again.";
    default:
      return "We could not find that order.";
  }
}
