import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing.
 *
 * argon2id at the parameters OWASP recommends: 19 MiB of memory, two passes,
 * one lane. The memory is the point. bcrypt uses about 4 KB, so an attacker with
 * a GPU — thousands of small cores — can guess enormously in parallel for very
 * little money. Demanding 19 MiB per guess collapses that advantage, because a
 * GPU has cores in abundance and memory in scarcity.
 *
 * Computed by Node's own `crypto.argon2` (Node 24.7 and later) rather than a
 * third-party native addon. The addon shipped an unsigned binary, which Windows
 * Smart App Control refuses to load — so on a machine with it enforcing, sign-in,
 * the password tests and the pre-push hook all failed. Node's implementation is
 * part of Node's own signed executable, needs no dependency, and produces
 * identical PHC strings: hashes written by the old library verify unchanged.
 */

/**
 * Refuse to load on a Node without argon2, rather than degrade silently.
 *
 * verifyPassword turns any error into `false`, which is right for one corrupt
 * row. On a Node older than 24.7, though, `argon2` is undefined, every
 * derivation throws, and every sign-in in the shop would fail with "those
 * details do not match an account" — indistinguishable from wrong passwords,
 * and so the failure nobody investigates. Failing here names the actual cause.
 */
if (typeof argon2 !== "function") {
  throw new Error(
    `Password hashing needs crypto.argon2, which arrived in Node 24.7. This is Node ${process.version}.`,
  );
}

const PARAMETERS = {
  /** In KiB. 19,456 KiB is 19 MiB. */
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

const SALT_BYTES = 16;

/**
 * The PHC string format every argon2 library reads and writes:
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`, both in unpadded standard
 * base64. Storing the parameters beside the hash is what lets them be raised
 * later without invalidating anybody's existing password.
 */
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * Long enough to be worth hashing, short enough not to be a denial of service.
 *
 * Deliberately no composition rules — no "must contain a symbol". They push
 * people towards `Password1!`, which is weaker than four random words, and
 * modern guidance dropped them years ago. Length is what matters, so the upper
 * bound is generous: a passphrase should be welcome.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** A message to show the person, or null when the password is acceptable. */
export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }

  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, PARAMETERS);
  const { memory, passes, parallelism } = PARAMETERS;

  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${unpadded(salt)}$${unpadded(tag)}`;
}

/**
 * Checks a password against a stored hash.
 *
 * Re-derives with the parameters recorded in the hash itself, not the current
 * ones, so raising the cost later leaves existing passwords working.
 *
 * Compared in constant time. An ordinary `===` stops at the first differing
 * byte, and how long it took to say no leaks how much of the hash was right.
 *
 * Returns false rather than throwing on a malformed hash. A row whose
 * passwordHash is corrupt should fail to authenticate, not crash the sign-in
 * page for everybody.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  const match = PHC.exec(digest);
  if (!match) return false;

  const [, memory, passes, parallelism, saltText, tagText] = match;
  const salt = Buffer.from(saltText, "base64");
  const expected = Buffer.from(tagText, "base64");

  try {
    const actual = await derive(password, salt, {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      tagLength: expected.length,
    });

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function derive(
  password: string,
  salt: Buffer,
  parameters: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...parameters }, (error, tag) =>
      error ? reject(error) : resolve(tag),
    );
  });
}

/** PHC strings use standard base64 without the trailing padding. */
function unpadded(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}

/**
 * Normalises an email for storage and comparison.
 *
 * Lowercased, because nobody thinks of Grace@ and grace@ as two accounts — and
 * allowing both means one of them can sign up and then find they cannot sign in,
 * because the lookup does not match what they typed.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A deliberately loose check.
 *
 * Validating email addresses by pattern is a losing game — the real grammar
 * admits things no regex handles, and every strict expression rejects somebody's
 * genuine address. This catches the typo (no @, no dot, a space) and leaves the
 * rest to the only test that matters, which is whether mail arrives.
 */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
