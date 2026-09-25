import { describe, expect, it } from "vitest";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  hashPassword,
  looksLikeEmail,
  normaliseEmail,
  verifyPassword,
} from "./password";

describe("hashing", () => {
  it("produces a verifiable argon2id hash", async () => {
    const digest = await hashPassword("correct horse battery staple");

    expect(digest).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(digest, "correct horse battery staple")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const digest = await hashPassword("correct horse battery staple");

    expect(await verifyPassword(digest, "Correct horse battery staple")).toBe(false);
    expect(await verifyPassword(digest, "")).toBe(false);
  });

  it("salts, so identical passwords do not share a hash", async () => {
    // Otherwise one cracked password reveals every account that reused it, and a
    // precomputed table cracks the lot at once.
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);

    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same password")).toBe(true);
    expect(await verifyPassword(b, "same password")).toBe(true);
  });

  it("uses parameters with real memory cost", async () => {
    // The memory figure is what makes GPU guessing expensive. If a future
    // upgrade quietly lowered it, this is the only thing that would notice.
    const digest = await hashPassword("whatever");
    const memoryKib = Number(/\$m=(\d+)/.exec(digest)?.[1]);

    expect(memoryKib).toBeGreaterThanOrEqual(19_456);
  });

  it("does not truncate long passphrases", async () => {
    // bcrypt silently ignores everything past 72 bytes, so two different long
    // passphrases sharing a prefix authenticate each other. argon2 does not.
    const shared = "a".repeat(80);
    const digest = await hashPassword(`${shared}-one`);

    expect(await verifyPassword(digest, `${shared}-two`)).toBe(false);
    expect(await verifyPassword(digest, `${shared}-one`)).toBe(true);
  });

  it("returns false for a corrupt hash instead of throwing", async () => {
    // One damaged row should fail to authenticate, not break sign-in for all.
    expect(await verifyPassword("not-a-hash", "password")).toBe(false);
    expect(await verifyPassword("", "password")).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts anything of reasonable length", () => {
    expect(checkPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(checkPassword("four random words together")).toBeNull();
  });

  it("rejects passwords that are too short", () => {
    expect(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toContain("at least");
    expect(checkPassword("")).toContain("at least");
  });

  it("rejects absurdly long ones, which are a denial of service rather than security", () => {
    expect(checkPassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toContain("at most");
  });

  it("imposes no composition rules", () => {
    // "Must contain a symbol" produces Password1!, which is weaker than four
    // random words. Guidance dropped these years ago.
    expect(checkPassword("all lowercase letters no digits")).toBeNull();
  });
});

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Grace@Example.COM ")).toBe("grace@example.com");
  });

  it("makes differing cases the same account", () => {
    expect(normaliseEmail("GRACE@example.com")).toBe(normaliseEmail("grace@EXAMPLE.com"));
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of ["grace@example.com", "a.b+tag@sub.example.co.ke"]) {
      expect(looksLikeEmail(email)).toBe(true);
    }
  });

  it("catches the typos worth catching", () => {
    for (const email of ["grace", "grace@", "@example.com", "grace example.com", ""]) {
      expect(looksLikeEmail(email)).toBe(false);
    }
  });
});
