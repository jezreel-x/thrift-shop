/**
 * URL slugs for product pages.
 *
 * These are a real part of how the catalogue gets found — `/products/vintage-
 * levis-501-straight-w32` tells a search engine what the page is about before it
 * reads a word of the content, and an opaque id tells it nothing.
 */

/** Longest slug we will generate, before any uniqueness suffix. */
const MAX_LENGTH = 80;

/** Used when a title contains nothing that survives slugification. */
const FALLBACK = "item";

/**
 * Combining marks, left behind by NFD normalisation once the base letter is
 * split out. The Unicode property escape is used in preference to a codepoint
 * range: it says what it means, and it keeps invisible characters — which no
 * editor renders and few diff tools survive — out of the source.
 */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Reduces arbitrary text to lowercase words joined by hyphens.
 *
 * Accents are folded rather than stripped, so "Étoile" becomes "etoile" instead
 * of "toile" — the word survives, which matters for a search term someone might
 * actually type. Returns an empty string when nothing usable is left; callers
 * that need a guaranteed slug should use {@link productSlug}.
 */
export function slugify(input: string): string {
  const folded = input.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

  const hyphenated = folded
    // "&" reads as a word in a title ("Dolce & Gabbana"), so keep it as one.
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return truncateAtWordBoundary(hyphenated, MAX_LENGTH);
}

/**
 * A slug guaranteed to be non-empty, with an optional suffix for uniqueness.
 *
 * Titles collide constantly in this catalogue — "black leather jacket" will be
 * used a dozen times — so the caller passes a short discriminator (a fragment of
 * the product id works well) when the bare slug is already taken.
 */
export function productSlug(title: string, suffix?: string): string {
  const base = slugify(title) || FALLBACK;
  const tail = suffix ? slugify(suffix) : "";

  return tail ? `${base}-${tail}` : base;
}

/**
 * Cuts to at most `max` characters without splitting a word, so a truncated
 * slug still reads as words rather than ending mid-syllable.
 */
function truncateAtWordBoundary(slug: string, max: number): string {
  if (slug.length <= max) return slug;

  const cut = slug.slice(0, max);
  const lastHyphen = cut.lastIndexOf("-");

  // A single word longer than the limit has no boundary to fall back to.
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, "");
}
