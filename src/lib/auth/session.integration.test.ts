import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { hashPassword } from "./password";
import {
  SESSION_DAYS,
  createSession,
  deleteExpiredSessions,
  destroyAllSessions,
  destroySession,
  readSession,
} from "./session";

const MS_PER_DAY = 86_400_000;

// The shared reset, not `user.deleteMany()`: a user with orders cannot be
// deleted, so that broke whenever an earlier file left an order behind.
cleanDatabaseBetweenTests();

async function makeUser(email = "grace@example.com") {
  return db.user.create({
    data: { email, passwordHash: await hashPassword("a good passphrase"), name: "Grace" },
  });
}

describe("createSession", () => {
  it("returns a token that resolves to its user", async () => {
    const user = await makeUser();

    const { token } = await createSession(user.id);

    expect(await readSession(token)).toMatchObject({
      id: user.id,
      email: "grace@example.com",
      name: "Grace",
    });
  });

  it("never stores the token itself", async () => {
    // A stolen copy of the database must not contain anything anyone can sign in
    // with. The row holds a hash; the token exists only in the cookie.
    const user = await makeUser();

    const { token } = await createSession(user.id);

    const stored = await db.session.findFirst({ where: { userId: user.id } });
    expect(stored?.id).not.toBe(token);
    expect(stored?.id).toHaveLength(64);
    expect(await db.session.findUnique({ where: { id: token } })).toBeNull();
  });

  it("issues a different token every time", async () => {
    const user = await makeUser();

    const [first, second] = await Promise.all([createSession(user.id), createSession(user.id)]);

    expect(first.token).not.toBe(second.token);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it("expires a week out", async () => {
    const user = await makeUser();

    const { expiresAt } = await createSession(user.id);

    const days = (expiresAt.getTime() - Date.now()) / MS_PER_DAY;
    expect(days).toBeGreaterThan(SESSION_DAYS - 0.01);
    expect(days).toBeLessThanOrEqual(SESSION_DAYS);
  });

  it("records the browser, truncating an over-long user agent", async () => {
    const user = await makeUser();

    await createSession(user.id, { userAgent: "x".repeat(2000), ipAddress: "41.90.0.1" });

    const stored = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.userAgent).toHaveLength(500);
    expect(stored.ipAddress).toBe("41.90.0.1");
  });
});

describe("readSession", () => {
  it("returns null for nothing, nonsense, or a token that was never issued", async () => {
    expect(await readSession(undefined)).toBeNull();
    expect(await readSession("")).toBeNull();
    expect(await readSession("not-a-real-token")).toBeNull();
  });

  it("refuses an expired session and clears it away", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await readSession(token)).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("leaves a fresh session alone rather than writing on every request", async () => {
    // Extending on each use would mean a database write per page view.
    const user = await makeUser();
    const { token } = await createSession(user.id);
    const before = await db.session.findFirstOrThrow({ where: { userId: user.id } });

    await readSession(token);

    const after = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
  });

  it("extends a session past its halfway point, so an active shopper stays in", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    // Five days used of seven: past halfway, two days left.
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() + 2 * MS_PER_DAY) },
    });

    await readSession(token);

    const after = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    const daysLeft = (after.expiresAt.getTime() - Date.now()) / MS_PER_DAY;
    expect(daysLeft).toBeGreaterThan(SESSION_DAYS - 0.01);
  });

  it("carries identity only — permissions are read fresh by the admin guard", async () => {
    // If the session carried permissions, a revoked role would linger until the
    // session was reissued — up to a week.
    const user = await makeUser();
    const { token } = await createSession(user.id);

    expect(Object.keys((await readSession(token)) ?? {}).sort()).toEqual([
      "email",
      "id",
      "name",
      "phone",
    ]);
  });

  it("never returns the password hash", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);

    expect(await readSession(token)).not.toHaveProperty("passwordHash");
  });
});

describe("destroySession", () => {
  it("signs out one browser and leaves the others signed in", async () => {
    const user = await makeUser();
    const phone = await createSession(user.id);
    const laptop = await createSession(user.id);

    await destroySession(phone.token);

    expect(await readSession(phone.token)).toBeNull();
    expect(await readSession(laptop.token)).not.toBeNull();
  });

  it("treats signing out twice as a success", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);

    await destroySession(token);
    await expect(destroySession(token)).resolves.toBeUndefined();
    await expect(destroySession(undefined)).resolves.toBeUndefined();
  });
});

describe("destroyAllSessions", () => {
  it("signs out every browser — one statement, no invalidation machinery", async () => {
    const user = await makeUser();
    const other = await makeUser("someone@example.com");
    const phone = await createSession(user.id);
    const laptop = await createSession(user.id);
    const stranger = await createSession(other.id);

    expect(await destroyAllSessions(user.id)).toBe(2);

    expect(await readSession(phone.token)).toBeNull();
    expect(await readSession(laptop.token)).toBeNull();
    expect(await readSession(stranger.token)).not.toBeNull();
  });
});

describe("deleteExpiredSessions", () => {
  it("clears what is expired and keeps what is not", async () => {
    const user = await makeUser();
    const live = await createSession(user.id);
    const stale = await createSession(user.id);

    // Expire exactly one, addressed by its own id rather than by ordering.
    const staleId = createHash("sha256").update(stale.token).digest("hex");
    await db.session.update({
      where: { id: staleId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await deleteExpiredSessions()).toBe(1);

    expect(await readSession(stale.token)).toBeNull();
    expect(await readSession(live.token)).not.toBeNull();
  });

  it("deletes a user's sessions when the user goes", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);

    await db.user.delete({ where: { id: user.id } });

    expect(await db.session.count()).toBe(0);
    expect(await readSession(token)).toBeNull();
  });
});
