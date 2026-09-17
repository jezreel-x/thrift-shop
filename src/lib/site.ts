/**
 * The site's own absolute URL.
 *
 * Vercel injects VERCEL_URL per deployment, so a preview build describes itself
 * rather than pointing canonical tags and link previews at production — which
 * would have search engines and shared links crediting the wrong deployment.
 */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
