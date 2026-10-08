import { Search } from "lucide-react";
import Link from "next/link";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { CUSTOMER_SORTS, customerListHref, parseCustomerQuery } from "@/lib/admin/customer-query";
import { type CustomerRow, listCustomers } from "@/lib/admin/customers";
import { staffTitle } from "@/lib/admin/metadata";
import { formatAge, formatDate, formatDateTime } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

export const generateMetadata = staffTitle("Customers", Permission.CUSTOMERS_VIEW);

export default async function AdminCustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requirePermission(Permission.CUSTOMERS_VIEW, "/admin/customers");

  const query = parseCustomerQuery(await searchParams);
  const { customers, total, pageCount } = await listCustomers(query);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
      <p className="mt-1 text-sm text-muted">
        Everyone with an account. Orders and spend count confirmed payments only.
      </p>

      <nav aria-label="Sort customers" className="mt-6">
        {/* Shared out across the width on a phone, so all three fit. */}
        <ul className="flex gap-1 rounded-xl border border-border bg-surface-muted/50 p-1 sm:inline-flex">
          {CUSTOMER_SORTS.map((option) => {
            const active = option.slug === query.sort;

            return (
              <li key={option.slug} className="flex-1 sm:flex-none">
                <Link
                  href={customerListHref({ search: query.search, sort: option.slug })}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-2 py-2 text-center text-[13px] whitespace-nowrap transition sm:px-4 sm:text-sm ${
                    active
                      ? "bg-surface font-medium text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* A plain GET form: the search lands in the URL, and works without JavaScript. */}
      <form action="/admin/customers" className="mt-4 flex gap-2">
        {query.sort !== "new" && <input type="hidden" name="sort" value={query.sort} />}
        <label className="relative flex-1 sm:max-w-sm">
          <span className="sr-only">Search customers</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Name, email or phone"
            className="w-full rounded-lg border border-border bg-transparent py-2 pr-3 pl-9 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-border px-4 text-sm transition hover:bg-surface-muted"
        >
          Search
        </button>
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
        {customers.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted">
            {query.search ? `Nobody matches “${query.search}”.` : "No customers yet."}
          </p>
        ) : (
          <>
            {/* Cards on a phone. */}
            <ul className="divide-y divide-border md:hidden">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="block p-4 transition hover:bg-surface-muted/50"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <Name customer={customer} />
                      <span className="text-sm font-medium tabular-nums">
                        {formatPrice(customer.spentCents)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted tabular-nums">
                      {customer.phone ? formatPhone(customer.phone) : customer.email}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {orders(customer.orders)} · <LastOrder customer={customer} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-border text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phone
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Orders
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Spent
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Last order
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((customer) => (
                  <tr key={customer.id} className="transition hover:bg-surface-muted/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        <Name customer={customer} />
                      </Link>
                      <p className="max-w-64 truncate text-xs text-muted">{customer.email}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {customer.phone ? formatPhone(customer.phone) : <Muted>—</Muted>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{customer.orders}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatPrice(customer.spentCents)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <LastOrder customer={customer} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(customer.joinedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <p className="tabular-nums">
            {total} {total === 1 ? "customer" : "customers"}
          </p>
          {pageCount > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-2">
              <PageLink
                href={customerListHref({ ...query, page: query.page - 1 })}
                disabled={query.page <= 1}
              >
                Previous
              </PageLink>
              <span className="tabular-nums">
                Page {Math.min(query.page, pageCount)} of {pageCount}
              </span>
              <PageLink
                href={customerListHref({ ...query, page: query.page + 1 })}
                disabled={query.page >= pageCount}
              >
                Next
              </PageLink>
            </nav>
          )}
        </div>
      )}
    </main>
  );
}

function Name({ customer }: { customer: CustomerRow }) {
  return (
    <span className="font-medium">
      {customer.name ?? <Muted>No name given</Muted>}
      {customer.isStaff && (
        <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted">
          Staff
        </span>
      )}
    </span>
  );
}

function LastOrder({ customer }: { customer: CustomerRow }) {
  return customer.lastOrderAt ? (
    <span title={formatDateTime(customer.lastOrderAt)}>{formatAge(customer.lastOrderAt)}</span>
  ) : (
    <Muted>Never ordered</Muted>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

function orders(count: number): string {
  return count === 1 ? "1 order" : `${count} orders`;
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "rounded-md border border-border px-3 py-1.5 text-xs";

  return disabled ? (
    <span aria-disabled="true" className={`${className} opacity-40`}>
      {children}
    </span>
  ) : (
    <Link
      href={href}
      className={`${className} transition hover:bg-surface-muted hover:text-foreground`}
    >
      {children}
    </Link>
  );
}
