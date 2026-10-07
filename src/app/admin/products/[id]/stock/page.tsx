import { ArrowLeft, ExternalLink, MessageCircle, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { can } from "@/lib/admin/permissions";
import { shareMessage } from "@/lib/admin/share";
import { HOLD_DURATIONS, type StockRow, getStockView } from "@/lib/admin/stock";
import {
  holdForWhatsAppAction,
  releaseHoldAction,
  sellHoldAction,
  soldElsewhereAction,
} from "@/lib/admin/stock-actions";
import { formatAge, formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/site";
import { whatsAppShareLink } from "@/lib/whatsapp";

type Props = PageProps<"/admin/products/[id]/stock">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { title: true } });

  return `Stock · ${product?.title ?? "Product"}`;
}, Permission.PRODUCTS_VIEW);

const DONE: Record<string, string> = {
  sold: "Marked sold. The website shows what's left.",
  held: "Held. Buyers on the website see it as taken until you sell it, release it, or it runs out.",
  "sold-hold": "Sold, and taken out of stock.",
  released: "Released. It's back on the website.",
};

function errorMessage(code: string, free: string | undefined): string {
  switch (code) {
    case "not-enough":
      return `Only ${free ?? 0} free right now. The rest are in buyers' checkouts or held on WhatsApp.`;
    case "lapsed":
      return "That hold ran out, so its units may be someone else's now. If it sold, use Sold elsewhere.";
    case "bad-input":
      return "Say who the hold is for, and a number of units from 1 to 99.";
    default:
      return "That's no longer there. This page shows what is now.";
  }
}

const SMALL_BUTTON =
  "rounded-md border border-border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition hover:bg-surface-muted";
const SMALL_INPUT =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-xs focus:border-foreground focus:outline-none";

export default async function ProductStockPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { access } = await requirePermission(
    Permission.PRODUCTS_VIEW,
    `/admin/products/${id}/stock`,
  );

  const [view, query] = await Promise.all([getStockView(id), searchParams]);
  if (!view) notFound();

  const allowed = {
    edit: can(access, Permission.PRODUCTS_EDIT),
    markSold: can(access, Permission.PRODUCTS_MARK_SOLD),
    hold: can(access, Permission.PRODUCTS_HOLD),
  };
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const error =
    typeof query.error === "string"
      ? errorMessage(query.error, typeof query.free === "string" ? query.free : undefined)
      : undefined;

  const { product, rows, holds, history } = view;
  const buyable = rows.filter((row) => row.free > 0);
  const share =
    !product.withdrawn && buyable.length > 0
      ? whatsAppShareLink(
          shareMessage({
            title: product.title,
            pricesCents: buyable.map((row) => row.priceCents),
            colours: buyable.flatMap((row) => (row.swatch ? [row.swatch] : [])),
            sizes: buyable.flatMap((row) => (row.option2 ? [row.option2] : [])),
            option1Name: product.option1Name,
            option2Name: product.option2Name,
            url: `${siteUrl}/products/${product.slug}`,
          }),
        )
      : null;

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Products
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {allowed.edit && (
              <Link
                href={`/admin/products/${product.id}`}
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                <Pencil aria-hidden className="size-3.5" />
                Edit product
              </Link>
            )}
            {product.withdrawn ? (
              <span className="text-amber-700 dark:text-amber-400">Off the shop</span>
            ) : (
              <Link
                href={`/products/${product.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                View on the shop
                <ExternalLink aria-hidden className="size-3.5" />
              </Link>
            )}
          </p>
        </div>
        {share && (
          <a
            href={share}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-4 py-2.5 text-sm font-medium text-green-700 transition hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950"
          >
            <MessageCircle aria-hidden className="size-4" />
            Share to WhatsApp
          </a>
        )}
      </div>

      {(done || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          }`}
        >
          {error ?? done}
        </p>
      )}

      <section aria-labelledby="stock" className="mt-8">
        <h2 id="stock" className="text-lg font-semibold">
          Stock
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Free is what the website can still sell. Units in buyers&apos; checkouts and WhatsApp
          holds are kept for them, so Sold elsewhere only takes free ones.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No sizes yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
            {rows.map((row) => (
              <li key={row.id} className="p-4">
                <StockLine row={row} productId={product.id} allowed={allowed} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="holds" className="mt-10">
        <h2 id="holds" className="text-lg font-semibold">
          Held on WhatsApp
        </h2>
        {holds.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            Nothing held. Hold units for somebody who asked in a chat, and the website keeps them
            for that person.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
            {holds.map((hold) => (
              <li key={hold.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {hold.note}{" "}
                    <span className="font-normal text-muted">
                      · {hold.label} × {hold.quantity}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {hold.lapsed ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        Ran out {formatDateTime(hold.expiresAt)}
                      </span>
                    ) : (
                      `Until ${formatDateTime(hold.expiresAt)}`
                    )}
                    {hold.placedBy && ` · held by ${hold.placedBy}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {allowed.markSold && !hold.lapsed && (
                    <form action={sellHoldAction}>
                      <input type="hidden" name="holdId" value={hold.id} />
                      <input type="hidden" name="productId" value={product.id} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Paid — mark sold
                      </button>
                    </form>
                  )}
                  {allowed.hold && (
                    <form action={releaseHoldAction}>
                      <input type="hidden" name="holdId" value={hold.id} />
                      <input type="hidden" name="productId" value={product.id} />
                      <button type="submit" className={SMALL_BUTTON}>
                        {hold.lapsed ? "Clear" : "Release"}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className="mt-10">
        <h2 id="history" className="text-lg font-semibold">
          Stock history
        </h2>
        {history.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No changes yet.</p>
        ) : (
          <>
            <ol className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {history.map((event) => (
                <li key={event.id} className="flex items-baseline gap-3 px-4 py-3">
                  <span
                    className={`w-10 shrink-0 text-right font-medium tabular-nums ${
                      event.change < 0
                        ? "text-red-700 dark:text-red-300"
                        : "text-green-700 dark:text-green-400"
                    }`}
                  >
                    {event.change > 0 ? `+${event.change}` : event.change}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{event.label}</span>{" "}
                    <span className="text-muted">
                      · {event.reason}
                      {event.orderReference && (
                        <>
                          {" "}
                          <Link
                            href={`/admin/orders/${event.orderReference}`}
                            className="font-mono text-xs underline underline-offset-2 hover:text-foreground"
                          >
                            {event.orderReference}
                          </Link>
                        </>
                      )}
                      {event.by && ` · ${event.by}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted" title={formatDateTime(event.at)}>
                    {formatAge(event.at)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted">The latest {history.length} changes.</p>
          </>
        )}
      </section>
    </main>
  );
}

/** One colour and size: its counts, and what this person may do with it. */
function StockLine({
  row,
  productId,
  allowed,
}: {
  row: StockRow;
  productId: string;
  allowed: { markSold: boolean; hold: boolean };
}) {
  const counts = [
    `${row.stock} in stock`,
    row.inCheckout > 0 && `${row.inCheckout} in checkout`,
    row.onWhatsApp > 0 && `${row.onWhatsApp} held on WhatsApp`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {row.hex && (
            <span
              aria-hidden
              className="size-3.5 rounded-full border border-border"
              style={{ backgroundColor: row.hex }}
            />
          )}
          {row.label}
        </p>
        <p className="text-sm text-muted">
          {counts.join(" · ")} ·{" "}
          <span
            className={`font-medium ${row.free > 0 ? "text-foreground" : "text-red-700 dark:text-red-300"}`}
          >
            {row.free > 0 ? `${row.free} free` : "none free"}
          </span>
        </p>
      </div>

      {row.free > 0 && (allowed.markSold || allowed.hold) && (
        <div className="flex flex-wrap items-start gap-2">
          {allowed.markSold && (
            <form action={soldElsewhereAction} className="flex items-center gap-2">
              <input type="hidden" name="variantId" value={row.id} />
              <input type="hidden" name="productId" value={productId} />
              <label className="sr-only" htmlFor={`sold-${row.id}`}>
                How many sold
              </label>
              <input
                id={`sold-${row.id}`}
                name="quantity"
                type="number"
                min={1}
                max={row.free}
                defaultValue={1}
                className={`${SMALL_INPUT} w-14`}
              />
              <button type="submit" className={SMALL_BUTTON}>
                Sold elsewhere
              </button>
            </form>
          )}

          {allowed.hold && (
            // A <details>: the hold form opens in place, with or without script.
            <details className="group">
              <summary className={`${SMALL_BUTTON} cursor-pointer list-none`}>
                Hold for WhatsApp
              </summary>
              <form
                action={holdForWhatsAppAction}
                className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
              >
                <input type="hidden" name="variantId" value={row.id} />
                <input type="hidden" name="productId" value={productId} />
                <input
                  name="note"
                  required
                  maxLength={80}
                  aria-label="Who it's for"
                  placeholder="Who it's for: Achieng, 0712…"
                  className={`${SMALL_INPUT} w-56`}
                />
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  max={row.free}
                  defaultValue={1}
                  aria-label="How many"
                  className={`${SMALL_INPUT} w-14`}
                />
                <select
                  name="duration"
                  defaultValue="1d"
                  aria-label="For how long"
                  className={`${SMALL_INPUT} bg-surface`}
                >
                  {Object.entries(HOLD_DURATIONS).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="submit" className={SMALL_BUTTON}>
                  Hold
                </button>
              </form>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
