import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { runHousekeeping } from "./housekeeping";

cleanDatabaseBetweenTests();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("runHousekeeping", () => {
  it("deletes only what already counts for nothing", async () => {
    const now = new Date();
    const at = (offset: number) => new Date(now.getTime() + offset);
    const product = await makeProduct({}, { stock: 5 });
    const user = await db.user.create({
      data: { email: "grace@example.com", passwordHash: await hashPassword("a good passphrase") },
    });

    // Holds: live, lapsed an hour ago (still shown as "Ran out"), lapsed two days ago.
    for (const [holder, expiresAt] of [
      ["live", at(HOUR)],
      ["recent", at(-HOUR)],
      ["old", at(-2 * DAY)],
    ] as const) {
      await db.stockHold.create({
        data: { variantId: product.variantId, holder, quantity: 1, expiresAt },
      });
    }

    // Sessions: one current, one expired.
    await db.session.createMany({
      data: [
        { id: "current", userId: user.id, expiresAt: at(DAY) },
        { id: "expired", userId: user.id, expiresAt: at(-HOUR) },
      ],
    });

    // Carts: a signed-in buyer's old cart is theirs; an anonymous one untouched
    // for two months is gone; a fresh anonymous one stays.
    await db.cart.create({ data: { id: "mine", userId: user.id } });
    await db.cart.create({ data: { id: "fresh" } });
    await db.cart.create({ data: { id: "stale" } });
    await db.$executeRaw`UPDATE "Cart" SET "updatedAt" = now() - interval '60 days' WHERE id IN ('mine', 'stale')`;

    expect(await runHousekeeping(now)).toEqual({ holds: 1, sessions: 1, carts: 1 });

    expect(
      (await db.stockHold.findMany({ orderBy: { holder: "asc" } })).map((h) => h.holder),
    ).toEqual(["live", "recent"]);
    expect((await db.session.findMany()).map((s) => s.id)).toEqual(["current"]);
    expect((await db.cart.findMany({ orderBy: { id: "asc" } })).map((c) => c.id)).toEqual([
      "fresh",
      "mine",
    ]);
  });
});
