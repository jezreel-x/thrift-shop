import { describe, expect, it } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { CUSTOMERS_PAGE_SIZE, getCustomer, listCustomers } from "./customers";

cleanDatabaseBetweenTests();

const DAY = 86_400_000;
const start = new Date("2026-09-01T09:00:00Z").getTime();
let reference = 0;

async function customer(name: string, joinedDay: number, phone: string | null = null) {
  return db.user.create({
    data: {
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      name,
      phone,
      passwordHash: "not used here",
      createdAt: new Date(start + joinedDay * DAY),
    },
  });
}

async function order(userId: string, totalCents: number, status: OrderStatus, day: number) {
  const product = await makeProduct();
  reference += 1;

  return db.order.create({
    data: {
      reference: `TP-C${String(reference).padStart(5, "0")}`,
      userId,
      status,
      buyerName: "Buyer",
      buyerPhone: "254700000000",
      totalCents,
      createdAt: new Date(start + day * DAY),
      items: {
        create: {
          productId: product.id,
          variantId: product.variantId,
          title: product.title,
          size: "M",
          priceCents: totalCents,
        },
      },
    },
  });
}

const names = (rows: { name: string | null }[]) => rows.map((row) => row.name);

describe("listCustomers", () => {
  async function shop() {
    const achieng = await customer("Achieng Otieno", 1, "254712345678");
    const brian = await customer("Brian Kamau", 2);
    const chebet = await customer("Chebet Rono", 3);
    const dan = await customer("Dan Mwangi", 4);

    await order(achieng.id, 300_000, OrderStatus.CONFIRMED, 5);
    await order(brian.id, 100_000, OrderStatus.CONFIRMED, 9);
    await order(brian.id, 100_000, OrderStatus.CONFIRMED, 10);
    // Neither is a purchase: one rejected, one never paid.
    await order(chebet.id, 900_000, OrderStatus.REJECTED, 11);
    await order(dan.id, 900_000, OrderStatus.AWAITING_PAYMENT, 12);

    return { achieng, brian, chebet, dan };
  }

  it("lists newest accounts first by default, with confirmed orders and spend", async () => {
    await shop();

    const { customers, total } = await listCustomers({ search: "", sort: "new", page: 1 });

    expect(total).toBe(4);
    expect(names(customers)).toEqual([
      "Dan Mwangi",
      "Chebet Rono",
      "Brian Kamau",
      "Achieng Otieno",
    ]);
    expect(customers.find((row) => row.name === "Brian Kamau")).toMatchObject({
      orders: 2,
      spentCents: 200_000,
    });
    // A rejected payment is not spending, though it was placed.
    expect(customers.find((row) => row.name === "Chebet Rono")).toMatchObject({
      orders: 0,
      spentCents: 0,
      lastOrderAt: new Date(start + 11 * DAY),
    });
    // An unpaid checkout is neither spending nor activity.
    expect(customers.find((row) => row.name === "Dan Mwangi")).toMatchObject({
      orders: 0,
      lastOrderAt: null,
    });
  });

  it("ranks by what was actually spent, then everyone else newest first", async () => {
    await shop();

    const { customers } = await listCustomers({ search: "", sort: "spent", page: 1 });

    expect(names(customers)).toEqual([
      "Achieng Otieno",
      "Brian Kamau",
      "Dan Mwangi",
      "Chebet Rono",
    ]);
  });

  it("ranks by the last order that reached a payment claim", async () => {
    await shop();

    const { customers } = await listCustomers({ search: "", sort: "recent", page: 1 });

    // Chebet's rejected claim was the latest; Dan never claimed a payment.
    expect(names(customers)).toEqual([
      "Chebet Rono",
      "Brian Kamau",
      "Achieng Otieno",
      "Dan Mwangi",
    ]);
  });

  it("pages across the join between buyers and everyone else without losing or repeating anyone", async () => {
    // More than a page of buyers, then non-buyers, so a page straddles the two.
    const buyers = CUSTOMERS_PAGE_SIZE + 3;
    for (let n = 0; n < buyers; n += 1) {
      const user = await customer(`Buyer ${n}`, n);
      await order(user.id, (n + 1) * 1_000, OrderStatus.CONFIRMED, 40);
    }
    for (let n = 0; n < 4; n += 1) await customer(`Browser ${n}`, 100 + n);

    const pages = await Promise.all(
      [1, 2].map((page) => listCustomers({ search: "", sort: "spent", page })),
    );
    const all = pages.flatMap((page) => names(page.customers));

    expect(pages[0].customers).toHaveLength(CUSTOMERS_PAGE_SIZE);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(buyers + 4);
    // Page 2: the last three buyers, by spend, then the browsers, newest first.
    expect(names(pages[1].customers)).toEqual([
      "Buyer 2",
      "Buyer 1",
      "Buyer 0",
      "Browser 3",
      "Browser 2",
      "Browser 1",
      "Browser 0",
    ]);
  });

  it("finds people by name, email, or a phone number typed any way", async () => {
    await shop();

    const find = async (search: string) =>
      names((await listCustomers({ search, sort: "new", page: 1 })).customers);

    expect(await find("brian")).toEqual(["Brian Kamau"]);
    expect(await find("chebet.rono@")).toEqual(["Chebet Rono"]);
    expect(await find("0712 345 678")).toEqual(["Achieng Otieno"]);
    // A search applies to every sort, including the ranked ones.
    expect(names((await listCustomers({ search: "a", sort: "spent", page: 1 })).customers)).toEqual(
      ["Achieng Otieno", "Brian Kamau", "Dan Mwangi", "Chebet Rono"],
    );
  });
});

describe("getCustomer", () => {
  it("shows their orders, newest first, with the same totals as the list", async () => {
    const buyer = await customer("Achieng Otieno", 1, "254712345678");
    await order(buyer.id, 300_000, OrderStatus.CONFIRMED, 5);
    await order(buyer.id, 50_000, OrderStatus.REJECTED, 6);

    const detail = await getCustomer(buyer.id);

    expect(detail?.stats).toEqual({
      orders: 1,
      spentCents: 300_000,
      lastOrderAt: new Date(start + 6 * DAY),
    });
    expect(detail?.orders.map((row) => row.status)).toEqual(["REJECTED", "CONFIRMED"]);
    expect(await getCustomer("nobody")).toBeNull();
  });
});
