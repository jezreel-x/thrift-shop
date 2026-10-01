import { describe, expect, it } from "vitest";

import { firstName, whatsAppLink } from "./whatsapp";

describe("whatsAppLink", () => {
  it("opens a chat with the message written, safely encoded", () => {
    const link = whatsAppLink("254712345678", "Hi Grace, order TP-7K3M9Q & KSh 1,400 — sawa?");
    const url = new URL(link);

    expect(url.origin + url.pathname).toBe("https://wa.me/254712345678");
    expect(url.searchParams.get("text")).toBe("Hi Grace, order TP-7K3M9Q & KSh 1,400 — sawa?");
  });

  it("uses digits only in the number", () => {
    expect(whatsAppLink("+254 712 345 678", "x")).toMatch(/^https:\/\/wa\.me\/254712345678\?/);
  });
});

describe("firstName", () => {
  it("greets people by their first name", () => {
    expect(firstName("  Grace   Wanjiku ")).toBe("Grace");
  });

  it("falls back when there is no name to use", () => {
    expect(firstName("   ")).toBe("there");
  });
});
