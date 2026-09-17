import type { MetadataRoute } from "next";

import { listSitemapEntries } from "@/lib/products";
import { siteUrl } from "@/lib/site";

/**
 * Served at /sitemap.xml.
 *
 * Forced dynamic for two reasons. Stock changes when the owner adds it, not
 * when the site is deployed, so a sitemap prerendered at build time would
 * advertise whatever the catalogue looked like at the last deploy. And the
 * build must not need a working database: CI builds against a placeholder
 * connection string, and prerendering this would try to reach a Postgres that
 * is not there.
 *
 * The cost is a query per request, which is negligible for a file only
 * crawlers fetch.
 */
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await listSitemapEntries();

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...products.map((product) => ({
      url: `${siteUrl}/products/${product.slug}`,
      // The row's own timestamp, so a crawler re-reads a page whose price or
      // status actually changed rather than all of them every time.
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
