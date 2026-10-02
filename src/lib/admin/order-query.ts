import { OrderStatus } from "@/generated/prisma/enums";

/**
 * The order queue's URL: which tab, what was searched, which page.
 *
 * In the query string for the same reasons as the catalogue's filters — a
 * reviewer can refresh, go back, or send a colleague the exact view — and read
 * as forgivingly: an unknown tab is the default tab, never an error.
 */

export const ORDER_TABS = [
  { slug: "to-confirm", status: OrderStatus.PENDING_CONFIRMATION, label: "To confirm" },
  { slug: "awaiting-payment", status: OrderStatus.AWAITING_PAYMENT, label: "Awaiting payment" },
  { slug: "confirmed", status: OrderStatus.CONFIRMED, label: "Confirmed" },
  { slug: "rejected", status: OrderStatus.REJECTED, label: "Rejected" },
  { slug: "cancelled", status: OrderStatus.CANCELLED, label: "Cancelled" },
] as const;

export type OrderTab = (typeof ORDER_TABS)[number];

export type OrderQuery = { tab: OrderTab; search: string; page: number };

type RawSearchParams = Record<string, string | string[] | undefined>;

const MAX_PAGE = 10_000;
const MAX_SEARCH = 100;

export function parseOrderQuery(raw: RawSearchParams): OrderQuery {
  const slug = first(raw.status);
  const tab = ORDER_TABS.find((candidate) => candidate.slug === slug) ?? ORDER_TABS[0];

  return {
    tab,
    search: (first(raw.q) ?? "").trim().slice(0, MAX_SEARCH),
    page: parsePage(first(raw.page)),
  };
}

/**
 * The path for a view of the queue, leaving defaults out so each view has one
 * address: /admin/orders, never /admin/orders?status=to-confirm&page=1.
 */
export function orderQueueHref(query: { tab?: OrderTab; search?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab.slug !== ORDER_TABS[0].slug) params.set("status", query.tab.slug);
  if (query.search) params.set("q", query.search);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();

  return search ? `/admin/orders?${search}` : "/admin/orders";
}

function parsePage(raw: string | undefined): number {
  // Digits only: Number() accepts "1e308", which would reach the database as an
  // OFFSET too large to run.
  if (raw === undefined || !/^\d+$/.test(raw)) return 1;

  return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
