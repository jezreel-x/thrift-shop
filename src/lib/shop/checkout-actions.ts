"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../auth/current-user";
import { clearCart } from "./cart";
import { readCartId } from "./cart-session";
import { type DeliveryField, parseDeliveryForm } from "./delivery";
import { claimPayment } from "./orders";
import { getDeliveryOptions, getPaymentDetails } from "./settings";
import { type PromptRefusal, requestPrompt } from "../payments/stk";
import { normalisePhone } from "../phone";
import { prisma } from "../prisma";

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
  // Straight to this order, not the list: the next thing the buyer wants to
  // know is what happens to the money they just sent.
  redirect(`/orders/${result.reference}`);
}

function explain(reason: string): string {
  switch (reason) {
    case "code-already-used":
      return "That code has already been used on another order. Check your M-Pesa messages for the right one.";
    case "already-claimed":
      return "You have already sent a code for this order. We are checking it.";
    case "hold-lapsed":
      return "Your hold on one of these pieces ran out. Go back to your cart and start again.";
    case "prompt-pending":
      return "We've sent an M-Pesa prompt for this order. Wait for it to finish before paying another way.";
    default:
      return "We could not find that order.";
  }
}

export type PromptFormState = { error?: string };

/**
 * Sends an M-Pesa prompt to the buyer's phone, then takes them to the order's
 * page, which waits for it to end. See src/lib/payments/stk.ts.
 */
export async function requestPromptAction(
  _previous: PromptFormState,
  formData: FormData,
): Promise<PromptFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Fcheckout");

  const result = await requestPrompt({
    orderId: String(formData.get("orderId") ?? ""),
    userId: user.id,
    phone: String(formData.get("phone") ?? ""),
    payment: await getPaymentDetails(),
  });

  if (!result.ok) return { error: explainPrompt(result.reason) };

  redirect(`/orders/${result.reference}`);
}

function explainPrompt(reason: PromptRefusal): string {
  switch (reason) {
    case "bad-phone":
      return "That is not a Kenyan mobile number. Try 0712 345 678.";
    case "prompt-pending":
      return "A prompt is already on its way to your phone. Wait for it to finish.";
    case "hold-lapsed":
      return "Your hold ran out, so these pieces are back on sale. Check out again to hold what's still free.";
    case "not-payable":
      return "This order isn't waiting for payment any more.";
    case "refused":
      return "M-Pesa couldn't send the prompt. Check the number, or pay the till yourself below.";
    case "not-offered":
    case "odd-amount":
      return "We can't send a prompt for this order. Pay the till yourself below.";
    default:
      return "We could not find that order.";
  }
}

export type ContactFormState = { error?: string };

/**
 * Collects the buyer's name and number, once, before anything is reserved.
 *
 * Asked before the holds start rather than after, so the fifteen minutes are
 * not spent typing. Saved to the account, so the second order asks for nothing.
 *
 * A shop that confirms payments by reading M-Pesa messages and arranges
 * delivery over WhatsApp cannot work without a number — this is not an optional
 * profile field, it is how the order gets fulfilled.
 */
export async function saveContactAction(
  _previous: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Fcheckout");

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalisePhone(String(formData.get("phone") ?? ""));

  if (name.length < 2) return { error: "Tell us what to call you." };
  if (!phone) {
    return { error: "That is not a Kenyan mobile number. Try 0712 345 678." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { name, phone } });

  redirect("/checkout");
}

export type DeliveryFormState = { errors?: Partial<Record<DeliveryField, string>> };

/**
 * How the buyer wants this order: pickup, or delivery to an area.
 *
 * Saved to the account before anything is reserved, for the same reason as the
 * phone number, and so the next order only has to confirm it.
 */
export async function saveDeliveryAction(
  _previous: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Fcheckout");

  const parsed = parseDeliveryForm(
    {
      fulfilment: String(formData.get("fulfilment") ?? ""),
      area: String(formData.get("area") ?? ""),
      address: String(formData.get("address") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    },
    await getDeliveryOptions(),
  );
  if (!parsed.ok) return { errors: parsed.errors };

  const { choice } = parsed;
  await prisma.user.update({
    where: { id: user.id },
    data:
      choice.fulfilment === "DELIVERY"
        ? {
            fulfilment: choice.fulfilment,
            deliveryAreaId: choice.area.id,
            deliveryAddress: choice.address,
            deliveryPhone: choice.phone,
          }
        : // The address is kept: picking up once doesn't mean forgetting home.
          { fulfilment: choice.fulfilment },
  });

  redirect("/checkout");
}
