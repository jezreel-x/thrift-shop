import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * argon2id, at the library's defaults, which are the parameters OWASP
 * recommends: 19 MiB of memory, two passes, one lane. The memory is the point.
 * bcrypt uses about 4 KB, so an attacker with a GPU — thousands of small cores —
 * can guess enormously in parallel for very little money. Demanding 19 MiB per
 * guess collapses that advantage, because a GPU has cores in abundance and
 * memory in scarcity.
 *
 * Measured at ~38ms per hash on this machine: unnoticeable once at sign-in, and
 * ruinous at a few billion attempts.
 */

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
  return hash(password);
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash. A row whose
 * passwordHash is corrupt should fail to authenticate, not crash the sign-in
 * page for everybody.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password);
  } catch {
    return false;
  }
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
