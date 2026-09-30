import { SiteHeader } from "@/components/site-header";

/**
 * The shop's frame: every public page, under the shop header.
 *
 * A route group — the parentheses keep "(shop)" out of every URL — so the
 * admin area can have a frame of its own without the shop's Cart and sign-in
 * links above it. One root layout above both, so moving between them is an
 * ordinary client-side navigation rather than a full page load.
 */
export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
