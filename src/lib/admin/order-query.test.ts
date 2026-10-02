import { describe, expect, it } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_TABS, orderQueueHref, parseOrderQuery } from "./order-query";

describe("parseOrderQuery", () => {
  it("defaults to orders waiting for a decision, first page, no search", () => {
    const query = parseOrderQuery({});

    expect(query.tab.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(query.search).toBe("");
    expect(query.page).toBe(1);
  });

  it("reads a tab, a search and a page", () => {
    const query = parseOrderQuery({ status: "confirmed", q: "  TP-7K3M9Q ", page: "3" });

    expect(query.tab.status).toBe(OrderStatus.CONFIRMED);
    expect(query.search).toBe("TP-7K3M9Q");
    expect(query.page).toBe(3);
  });

  it("treats a mangled link as the default view rather than an error", () => {
    const query = parseOrderQuery({ status: "CONFIRMED<script>", page: "1e308" });

    expect(query.tab).toBe(ORDER_TABS[0]);
    expect(query.page).toBe(1);
  });

  it("caps the page and the search length", () => {
    expect(parseOrderQuery({ page: "99999999" }).page).toBe(10_000);
    expect(parseOrderQuery({ q: "x".repeat(500) }).search).toHaveLength(100);
  });

  it("takes the first of repeated parameters", () => {
    expect(parseOrderQuery({ status: ["rejected", "confirmed"] }).tab.status).toBe(
      OrderStatus.REJECTED,
    );
  });
});

describe("orderQueueHref", () => {
  it("gives the default view one address", () => {
    expect(orderQueueHref({ tab: ORDER_TABS[0], page: 1 })).toBe("/admin/orders");
  });

  it("round-trips through the parser", () => {
    const href = orderQueueHref({ tab: ORDER_TABS[2], search: "Achieng O", page: 2 });
    const params = Object.fromEntries(new URL(href, "https://x").searchParams);

    expect(parseOrderQuery(params)).toEqual({ tab: ORDER_TABS[2], search: "Achieng O", page: 2 });
  });
});
