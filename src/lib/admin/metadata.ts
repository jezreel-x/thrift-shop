import type { Metadata } from "next";

import type { Permission } from "@/generated/prisma/enums";
import { getCurrentUser } from "../auth/current-user";
import { getStaffAccess } from "./access";
import { can } from "./permissions";

/**
 * An admin page's title, shown only to somebody allowed to open the page.
 *
 * A page's metadata is published even when the page itself answers 404, so a
 * fixed `export const metadata = { title: "Dashboard" }` would put "Dashboard"
 * in the browser tab of a customer being told there is nothing here. Everyone
 * else gets no title of the page's own, and so sees exactly what any address
 * that does not exist shows.
 *
 *   export const generateMetadata = staffTitle("Orders", Permission.ORDERS_VIEW);
 *
 * Costs one extra session lookup by primary key; the role lookup is memoised
 * for the request and shared with the page. getCurrentUser is deliberately not
 * memoised: Server Actions re-render within the request that signed somebody
 * in or out, and a cached answer to "who is this?" would be stale exactly then.
 */
export function staffTitle<Props>(
  title: string | ((props: Props) => Promise<string>),
  permission?: Permission,
) {
  return async function generateMetadata(props: Props): Promise<Metadata> {
    const user = await getCurrentUser();
    const access = user ? await getStaffAccess(user.id) : null;

    const allowed = access !== null && (permission === undefined || can(access, permission));
    if (!allowed) return {};

    // Only worked out for somebody allowed to see it: a title built from the
    // URL — "Order TP-7K3M9Q" — would otherwise confirm the order exists.
    const text = typeof title === "string" ? title : await title(props);

    return { title: { absolute: `${text} · Admin | The Thrift Plug` } };
  };
}
