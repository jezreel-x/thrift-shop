import { describe, expect, it } from "vitest";

import { PaymentMethod } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { getPaymentDetails, getShopWhatsApp } from "@/lib/shop/settings";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { saveDeliverySettings } from "./delivery-settings";
import {
  clearPaymentSettings,
  getPaymentSettingsFormValues,
  getWhatsAppFormValue,
  listSettingsHistory,
  savePaymentSettings,
  saveWhatsAppNumber,
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

    const [latest] = await listSettingsHistory();
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

describe("clearPaymentSettings", () => {
  it("takes payment offline and records what was removed", async () => {
    const owner = await staff();
    await savePaymentSettings({ value: TILL, actorId: owner.id });

    expect(await clearPaymentSettings({ actorId: owner.id })).toEqual({ changed: true });

    expect(await getPaymentDetails()).toBeNull();
    expect((await getPaymentSettingsFormValues()).number).toBe("");
    const removal = await db.auditLog.findFirstOrThrow({
      where: { action: "settings.clear-payment" },
    });
    expect(removal).toMatchObject({
      actorId: owner.id,
      before: { method: "TILL", number: "123456", name: "THE THRIFT PLUG" },
    });

    const [latest] = await listSettingsHistory();
    expect(latest.changes).toEqual([
      "Payment details removed: checkout shows payment as not set up",
    ]);
  });

  it("does nothing, and records nothing, when there is nothing to remove", async () => {
    const owner = await staff();

    expect(await clearPaymentSettings({ actorId: owner.id })).toEqual({ changed: false });
    expect(await db.auditLog.count()).toBe(0);
  });

  it("lets new details be saved afterwards, described as set for the first time again", async () => {
    const owner = await staff();
    await savePaymentSettings({ value: TILL, actorId: owner.id });
    await clearPaymentSettings({ actorId: owner.id });

    await savePaymentSettings({ value: { ...TILL, number: "654321" }, actorId: owner.id });

    expect((await getPaymentDetails())?.number).toBe("654321");
  });
});

describe("saveWhatsAppNumber", () => {
  it("stores the number however it is typed, and records the change", async () => {
    const owner = await staff();

    expect(await saveWhatsAppNumber({ raw: "0712 345 678", actorId: owner.id })).toEqual({
      ok: true,
      changed: true,
    });

    expect(await getShopWhatsApp()).toBe("254712345678");
    expect(await getWhatsAppFormValue()).toBe("0712 345 678");
    const [latest] = await listSettingsHistory();
    expect(latest.changes).toEqual(["WhatsApp number: (none) → 0712 345 678"]);
  });

  it("clears it when left empty, which hides the button", async () => {
    const owner = await staff();
    await saveWhatsAppNumber({ raw: "0712345678", actorId: owner.id });

    await saveWhatsAppNumber({ raw: "  ", actorId: owner.id });

    expect(await getShopWhatsApp()).toBeNull();
  });

  it("refuses something that is not a mobile number, and changes nothing", async () => {
    const owner = await staff();

    const result = await saveWhatsAppNumber({ raw: "020 123 4567", actorId: owner.id });

    expect(result.ok).toBe(false);
    expect(await getShopWhatsApp()).toBeNull();
    expect(await db.auditLog.count()).toBe(0);
  });

  it("leaves the payment details alone", async () => {
    const owner = await staff();
    await savePaymentSettings({ value: TILL, actorId: owner.id });

    await saveWhatsAppNumber({ raw: "0712345678", actorId: owner.id });

    expect((await getPaymentDetails())?.number).toBe("123456");
  });
});

describe("listSettingsHistory", () => {
  it("lists every kind of change newest first, or only the kind asked for", async () => {
    const owner = await staff();
    await savePaymentSettings({ value: TILL, actorId: owner.id });
    await saveWhatsAppNumber({ raw: "0712345678", actorId: owner.id });
    await saveDeliverySettings({
      value: { pickupAddress: "HH Towers", areas: [] },
      actorId: owner.id,
    });

    expect((await listSettingsHistory()).map((change) => change.type)).toEqual([
      "delivery",
      "whatsapp",
      "payment",
    ]);
    expect(await listSettingsHistory({ type: "whatsapp" })).toMatchObject([
      { type: "whatsapp", actor: "Wanjiru", changes: ["WhatsApp number: (none) → 0712 345 678"] },
    ]);
    expect((await listSettingsHistory({ type: "delivery" }))[0].changes).toEqual([
      "Pickup point: (none) → HH Towers",
    ]);
  });
});
