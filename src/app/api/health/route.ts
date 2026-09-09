import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Liveness plus database reachability.
 *
 * Deliberately uncached: the point is to report the state of this deployment
 * right now, which is what makes it useful as the Phase 0 proof that the app
 * really is talking to hosted Postgres.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("Health check failed to reach the database", error);

    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      database: "reachable",
      latencyMs: Math.round(performance.now() - startedAt),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
