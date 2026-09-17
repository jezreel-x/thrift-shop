import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Served at /robots.txt.
 *
 * Currently disallows everything, matching the `noindex` on the pages
 * themselves. The catalogue is populated with placeholder photography that is
 * not the shop's to publish, so nothing here should be indexed until the
 * owner's own images replace it.
 *
 * TODO: when that happens, swap `disallow` for the block below and drop the
 * `robots` entries from the page metadata:
 *
 *   rules: { userAgent: "*", allow: "/", disallow: "/api/" }
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
