import { timingSafeEqual } from "node:crypto";

import { SettledVia } from "@/generated/prisma/enums";
import { mpesaConfig } from "@/lib/mpesa/config";
import { parseCallback } from "@/lib/mpesa/daraja";
import { checkPrompt } from "@/lib/payments/stk";
import { prisma } from "@/lib/prisma";

/**
 * Where Safaricom reports how an M-Pesa prompt ended.
 *
 * A public URL that anyone can post to, so what arrives is a hint, never proof:
 * checkPrompt asks Safaricom itself and settles on that answer. The secret in
 * the path keeps out casual posts; it is not what makes a forged "paid"
 * harmless. That is the question to Safaricom.
 *
 * Always a quick 200 for anything that reaches a real prompt, including
 * duplicates and ones already settled: Safaricom retries what it thinks
 * failed, and settling twice changes nothing.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/payments/callback/[secret]">) {
  const config = mpesaConfig();
  const { secret } = await ctx.params;
  if (!config || !sameSecret(secret, config.callbackSecret)) {
    return new Response(null, { status: 404 });
  }

  const callback = parseCallback(await request.json().catch(() => null));
  if (callback) {
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: callback.checkoutRequestId },
      select: { id: true },
    });
    if (payment) {
      try {
        await checkPrompt(payment.id, SettledVia.CALLBACK, { callback });
      } catch (error) {
        // Still a 200: the buyer's page, staff and the housekeeping all ask
        // again, and an error here would only make Safaricom retry into it.
        console.error("Settling an M-Pesa callback failed", error);
      }
    }
  }

  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}

/** Constant time, so the response says nothing about how much of a guess was right. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}
