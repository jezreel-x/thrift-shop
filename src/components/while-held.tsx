"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

/**
 * Shows its children — the till and the code form — only while checkout's
 * holds last.
 *
 * A checkout tab left open shows the till long after the pieces have gone back
 * on sale, and a buyer who pays from it has sent money for an order the shop
 * will refuse. So when the hold runs out, the payment details give way to
 * saying so. Without JavaScript the details stay, and a code sent too late is
 * still refused by the server; this only stops the money being sent.
 */
export function WhileHeld({
  until,
  untilLabel,
  children,
}: {
  /** ISO time the holds run out. */
  until: string;
  /** The same time, as the shop shows it ("16:24", Nairobi). */
  untilLabel: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setOver(true),
      Math.max(0, new Date(until).getTime() - Date.now()),
    );

    return () => clearTimeout(timer);
  }, [until]);

  if (!over) return children;

  return (
    <div
      role="alert"
      className="mt-10 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <p>
        Your hold ran out at {untilLabel}, so these pieces are back on sale. Don&rsquo;t pay for
        this order now: check out again, and we&rsquo;ll hold whatever is still free.
      </p>
      <Link
        href="/checkout"
        className="mt-3 inline-block font-medium underline underline-offset-4"
        // A fresh render of checkout, which reserves again.
        prefetch={false}
      >
        Check out again
      </Link>
    </div>
  );
}
