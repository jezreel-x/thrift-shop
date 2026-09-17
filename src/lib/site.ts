/**
 * The site's own absolute URL, used for canonical tags, Open Graph images and
 * the sitemap.
 *
 * The order matters. Vercel exposes two different URLs and picking the wrong
 * one is an SEO bug rather than a cosmetic one:
 *
 * - VERCEL_PROJECT_PRODUCTION_URL is the project's stable production domain.
 *   It is the same on every deploy, which is exactly what a canonical tag has
 *   to be — an address that changes each time you push tells search engines
 *   the page moved.
 * - VERCEL_URL identifies one specific deployment (`thrift-shop-dc7r7icsy-…`).
 *   Right for a preview, which should describe itself rather than claiming to
 *   be production, and wrong for anything permanent.
 *
 * NEXT_PUBLIC_SITE_URL overrides both, for when a real domain is attached.
 */
function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  // Only production should claim the production domain; a preview deployment
  // sees this variable too, and using it there would have every preview
  // insisting it is the live site.
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return "http://localhost:3000";
}

export const siteUrl = resolveSiteUrl();
