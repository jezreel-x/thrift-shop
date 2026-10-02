import { describe, expect, it } from "vitest";

import { PaymentMethod } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { getPaymentDetails } from "@/lib/shop/settings";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  getPaymentSettingsFormValues,
  listPaymentSettingsHistory,
  savePaymentSettings,
} from "./payment-settings";

cleanDatabaseBetweenTests();

const TILL = {
  method: PaymentMethod.TILL,
  number: "123456",
  accountNumber: null,
  name: "THE THRIFT PLUG",
  note: null,
};

async function staff(name = "Wanjiru") {
  return db.user.create({
    data: {
      email: `${name.toLowerCase()}@example.com`,
      name,
      passwordHash: await hashPassword("a good passphrase"),
    },
  });
}

describe("savePaymentSettings", () => {
  it("saves what checkout shows, and records who set it", async () => {
    const owner = await staff();

    expect(await savePaymentSettings({ value: TILL, actorId: owner.id })).toEqual({
      changed: true,
    });

    expect(await getPaymentDetails()).toEqual({
      method: PaymentMethod.TILL,
      number: "123456",
      accountNumber: null,
      name: "THE THRIFT PLUG",
      note: null,
    });
    const [entry] = await db.auditLog.findMany();
    expect(entry).toMatchObject({
      actorId: owner.id,
      action: "settings.update-payment",
      entityType: "ShopSettings",
      before: null,
      after: { method: "TILL", number: "123456", name: "THE THRIFT PLUG" },
    });
  });

  it("records the old and new values, so a swapped till number is visible", async () => {
    const owner = await staff("Wanjiru");
    const cashier = await staff("Otieno");
    await savePaymentSettings({ value: TILL, actorId: owner.id });

    await savePaymentSettings({ value: { ...TILL, number: "999999" }, actorId: cashier.id });

    const [latest] = await listPaymentSettingsHistory();
    expect(latest.actor).toBe("Otieno");
    expect(latest.changes).toEqual(["Number: 123456 → 999999"]);
  });

  it("does not record saving the same details again", async () => {
    const owner = await staff();
    await savePaymentSettings({ value: TILL, actorId: owner.id });

    expect(await savePaymentSettings({ value: TILL, actorId: owner.id })).toEqual({
      changed: false,
    });
    expect(await db.auditLog.count()).toBe(1);
  });

  it("gives the form a Send Money number back the way it was typed", async () => {
    const owner = await staff();
    await savePaymentSettings({
      value: { ...TILL, method: PaymentMethod.POCHI, number: "254712345678", name: "JANE WANJIKU" },
      actorId: owner.id,
    });

    expect((await getPaymentSettingsFormValues()).number).toBe("0712 345 678");
  });
});

describe("getPaymentDetails", () => {
  it("treats details without the M-Pesa name as not set up", async () => {
    // Checkout tells buyers to stop if M-Pesa shows another name. Without a
    // saved name there is nothing honest to tell them.
    await db.shopSettings.create({
      data: { id: "singleton", payment: PaymentMethod.TILL, tillNumber: "123456" },
    });

    expect(await getPaymentDetails()).toBeNull();
  });

  it("is null before anything is saved", async () => {
    expect(await getPaymentDetails()).toBeNull();
    expect(await getPaymentSettingsFormValues()).toEqual({
      method: "",
      number: "",
      accountNumber: "",
      name: "",
      note: "",
    });
  });
});
