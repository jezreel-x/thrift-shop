import { isCronRequest, runHousekeeping } from "@/lib/housekeeping";

/**
 * The daily tidy-up, called by Vercel Cron (see vercel.json).
 *
 * Only with the cron secret: Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set on the project. Without it configured, nothing runs.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }

  const report = await runHousekeeping();

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
