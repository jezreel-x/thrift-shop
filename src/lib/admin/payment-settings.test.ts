import { describe, expect, it } from "vitest";

import { PaymentMethod } from "@/generated/prisma/enums";
import { describeChanges, parsePaymentSettings } from "./payment-settings";

const TILL = { method: "TILL", number: "123 456", name: "  THE   THRIFT PLUG ", note: "" };

describe("parsePaymentSettings", () => {
  it("accepts a till, tidying spaces in the number and the name", () => {
    expect(parsePaymentSettings(TILL)).toEqual({
      ok: true,
      value: {
        method: PaymentMethod.TILL,
        number: "123456",
        accountNumber: null,
        name: "THE THRIFT PLUG",
        note: null,
      },
    });
  });

  it("stores a Send Money number in one canonical form, however it was typed", () => {
    for (const typed of ["0712 345 678", "+254712345678", "254712345678"]) {
      const result = parsePaymentSettings({ method: "POCHI", number: typed, name: "JANE WANJIKU" });
      expect(result.ok && result.value.number, typed).toBe("254712345678");
    }
  });

  it("refuses a number that is not a Safaricom line for Send Money", () => {
    const result = parsePaymentSettings({ method: "POCHI", number: "020 123 4567", name: "JANE" });
    expect(result).toMatchObject({ ok: false, errors: { number: expect.any(String) } });
  });

  it("refuses a till or paybill number that is not 5 to 8 digits", () => {
    for (const number of ["1234", "123456789", "12a456"]) {
      const result = parsePaymentSettings({ ...TILL, number });
      expect(result, number).toMatchObject({ ok: false, errors: { number: expect.any(String) } });
    }
  });

  it("requires an account number for a paybill, and only for a paybill", () => {
    expect(
      parsePaymentSettings({ method: "PAYBILL", number: "522522", name: "KCB" }),
    ).toMatchObject({ ok: false, errors: { accountNumber: expect.any(String) } });

    const paybill = parsePaymentSettings({
      method: "PAYBILL",
      number: "522522",
      accountNumber: " 1234 5678 ",
      name: "KCB",
    });
    expect(paybill.ok && paybill.value.accountNumber).toBe("1234 5678");

    // A stale account number left over from a paybill must not follow a till.
    const till = parsePaymentSettings({ ...TILL, accountNumber: "1234" });
    expect(till.ok && till.value.accountNumber).toBeNull();
  });

  it("requires the name M-Pesa shows, because checkout tells buyers to check it", () => {
    expect(parsePaymentSettings({ ...TILL, name: " " })).toMatchObject({
      ok: false,
      errors: { name: expect.any(String) },
    });
    expect(parsePaymentSettings({ ...TILL, name: "X".repeat(61) })).toMatchObject({
      ok: false,
      errors: { name: expect.any(String) },
    });
  });

  it("asks for a method rather than guessing one, and reports every problem at once", () => {
    const result = parsePaymentSettings({ method: "CASH", number: "", name: "" });
    expect(result).toMatchObject({ ok: false, errors: { method: expect.any(String) } });

    const several = parsePaymentSettings({ method: "TILL", number: "", name: "" });
    expect(several.ok === false && Object.keys(several.errors).sort()).toEqual(["name", "number"]);
  });

  it("ignores fields it does not know, such as Next's action id", () => {
    expect(parsePaymentSettings({ ...TILL, $ACTION_ID_abc: "" }).ok).toBe(true);
  });
});

describe("describeChanges", () => {
  it("says when details were set for the first time", () => {
    expect(describeChanges(null, { method: "TILL", number: "123456" })).toEqual([
      "Payment details set for the first time",
    ]);
  });

  it("lists exactly what changed, old value first", () => {
    const before = { method: "TILL", number: "123456", name: "THE THRIFT PLUG", note: null };
    const after = { method: "TILL", number: "654321", name: "THE THRIFT PLUG", note: "Hi" };

    expect(describeChanges(before, after)).toEqual([
      "Number: 123456 → 654321",
      "Note: (none) → Hi",
    ]);
  });

  it("names the method the way the form did", () => {
    expect(describeChanges({ method: "TILL" }, { method: "POCHI" })).toEqual([
      "Method: Till → Send Money",
    ]);
  });

  it("shows a phone number the way a Kenyan reads it", () => {
    expect(
      describeChanges(
        { method: "POCHI", number: "254712345678" },
        { method: "POCHI", number: "254798765432" },
      ),
    ).toEqual(["Number: 0712 345 678 → 0798 765 432"]);
  });
});
