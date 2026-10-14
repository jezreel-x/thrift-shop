import { getCurrentUser } from "@/lib/auth/current-user";
import { checkPromptForBuyer } from "@/lib/payments/stk";

/**
 * Where the buyer's order page asks "has my M-Pesa prompt ended?" while it
 * waits. Asks Safaricom when it is time to (src/lib/payments/stk.ts spaces the
 * questions out), so the page learns the result even if Safaricom's callback
 * never comes.
 *
 * The buyer's own orders only: someone else's reference is a 404, as on the
 * order page.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/orders/[reference]/payment">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in." }, { status: 401 });

  const { reference } = await ctx.params;
  const state = await checkPromptForBuyer(reference.toUpperCase(), user.id);
  if (!state) return Response.json({ error: "Not found." }, { status: 404 });

  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
