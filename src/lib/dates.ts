/**
 * Dates as the shop reads them: Nairobi time, whatever the server's clock says.
 *
 * Vercel's servers run on UTC, so a date formatted without a time zone would
 * tell the owner a payment arrived at 06:12 when her phone says 09:12 — and the
 * time is exactly what she matches against her M-Pesa messages.
 */

const TIME_ZONE = "Africa/Nairobi";

const dateTime = new Intl.DateTimeFormat("en-KE", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("en-KE", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "30 Sept, 14:05" */
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

/** "30 Sept 2026" */
export function formatDate(date: Date): string {
  return dateOnly.format(date);
}

/**
 * How long ago, roughly: "just now", "12 min ago", "3 h ago", "2 days ago".
 * For the queue, where "how long has this buyer been waiting" is the question.
 */
export function formatAge(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);

  return days === 1 ? "1 day ago" : `${days} days ago`;
}
