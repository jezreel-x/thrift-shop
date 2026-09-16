import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Product photography lives in Vercel Blob. next/image refuses any host not
    // listed here, and rightly so — without an allow-list the optimiser becomes
    // a free image proxy for the whole internet, billed to this project.
    //
    // Matched by pattern rather than hard-coded, because the hostname is derived
    // from the store id and a restored or replaced store would otherwise break
    // every image at once. Narrowed to products/ so it cannot serve anything
    // else that later lands in the bucket.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/products/**",
      },
    ],
  },
};

export default nextConfig;
