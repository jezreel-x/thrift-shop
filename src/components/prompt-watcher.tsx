"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** How often the page asks; the server asks Safaricom far less often than this. */
const POLL_MS = 4_000;
/** After this, the page stops asking by itself and says so. */
const GIVE_UP_MS = 3 * 60_000;

/**
 * Waits for an M-Pesa prompt to end, then shows the order as it now stands.
 *
 * Asks /api/orders/[reference]/payment every few seconds. That route asks
 * Safaricom when it's time to, so this works whether or not Safaricom's
 * callback ever arrives. Once the prompt is paid or not, the page re-renders
 * from the server: everything it then says comes from there, not from here.
 *
 * Without JavaScript the page says to reload, and reloading shows the answer.
 */
export function PromptWatcher({ reference }: { reference: string }) {
  const router = useRouter();
  // Bumped by "Check again", which starts a fresh round of asking.
  const [round, setRound] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function ask() {
      if (stopped) return;
      try {
        const response = await fetch(`/api/orders/${reference}/payment`, { cache: "no-store" });
        if (response.ok) {
          const state = (await response.json()) as { prompt: string | null };
          if (state.prompt !== "PENDING") {
            router.refresh();
            return;
          }
        }
      } catch {
        // A dropped connection on a phone is ordinary; the next round asks again.
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(ask, POLL_MS);
    }

    timer = setTimeout(ask, POLL_MS);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [reference, round, router]);

  if (!gaveUp) {
    return (
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
        This page updates by itself.
      </p>
    );
  }

  return (
    <div className="mt-3 text-sm" aria-live="polite">
      <p>
        We haven&rsquo;t heard back from M-Pesa yet. If money left your account, don&rsquo;t pay
        again: we&rsquo;ll match it to this order.
      </p>
      <button
        type="button"
        onClick={() => {
          setGaveUp(false);
          setRound((n) => n + 1);
        }}
        className="mt-2 font-medium underline underline-offset-4"
      >
        Check again
      </button>
    </div>
  );
}
