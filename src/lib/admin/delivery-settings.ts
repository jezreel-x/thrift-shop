import { InvalidPriceError, formatPrice, parsePriceToCents } from "../money";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";

/**
 * Where the shop delivers and what it charges: the pickup point and the list
 * of areas with their fees, as the buyer sees them at checkout.
 *
 * Audited like payment details: a fee is part of what buyers are asked to pay.
 * Orders copy the area's name and fee when placed, so changing or removing an
 * area here never alters an order already made.
 */

const SINGLETON = "singleton";
export const MAX_AREAS = 50;
const MAX_AREA_NAME = 40;
const MAX_PICKUP = 120;
/** KSh 100,000: well past any delivery fee, but catches a slipped zero or three. */
const MAX_FEE_CENTS = 10_000_000;

export type AreaInput = { id: string | null; name: string; fee: string };

export type DeliverySettings = {
  pickupAddress: string | null;
  areas: { id: string | null; name: string; feeCents: number }[];
};

export type DeliverySettingsErrors = { pickupAddress?: string; areas?: string } & Record<
  `area:${number}`,
  string
>;

export type DeliverySettingsParse =
  { ok: true; value: DeliverySettings } | { ok: false; errors: DeliverySettingsErrors };

/** Pure: the form's pickup field and its rows of areas. Empty rows are ignored. */
export function parseDeliverySettings(input: {
  pickupAddress: string;
  areas: AreaInput[];
}): DeliverySettingsParse {
  const errors: DeliverySettingsErrors = {};

  const pickupAddress = input.pickupAddress.trim().replace(/\s+/g, " ");
  if (pickupAddress.length > MAX_PICKUP) {
    errors.pickupAddress = `At most ${MAX_PICKUP} characters.`;
  }

  const rows = input.areas
    .map((area, index) => ({ ...area, index, name: area.name.trim().replace(/\s+/g, " ") }))
    .filter((area) => area.name !== "" || area.fee.trim() !== "");
  if (rows.length > MAX_AREAS) errors.areas = `At most ${MAX_AREAS} areas.`;

  const seen = new Set<string>();
  const areas: DeliverySettings["areas"] = [];
  for (const row of rows) {
    const key = `area:${row.index}` as const;
    const feeCents = readFee(row.fee);

    if (!row.name) errors[key] = "Name the area.";
    else if (row.name.length > MAX_AREA_NAME) errors[key] = `At most ${MAX_AREA_NAME} characters.`;
    else if (seen.has(row.name.toLowerCase())) errors[key] = `${row.name} is listed twice.`;
    else if (feeCents === null) errors[key] = "Enter the fee, such as 250, or 0 for free.";
    else if (feeCents > MAX_FEE_CENTS) errors[key] = "That fee looks too high.";

    seen.add(row.name.toLowerCase());
    if (feeCents !== null) areas.push({ id: row.id, name: row.name, feeCents });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { pickupAddress: pickupAddress || null, areas } };
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  const [settings, areas] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { id: SINGLETON }, select: { pickupAddress: true } }),
    prisma.deliveryArea.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, feeCents: true },
    }),
  ]);

  return { pickupAddress: settings?.pickupAddress ?? null, areas };
}

/**
 * Replaces the pickup point and the area list with what the form holds:
 * rows with an id are updated, rows without are added, missing ones removed.
 */
export async function saveDeliverySettings(input: {
  value: DeliverySettings;
  actorId: string;
}): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.deliveryArea.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, feeCents: true },
    });
    const settings = await tx.shopSettings.findUnique({
      where: { id: SINGLETON },
      select: { pickupAddress: true },
    });
    const known = new Set(before.map((area) => area.id));
    if (input.value.areas.some((area) => area.id && !known.has(area.id))) {
      return { ok: false, error: "The list changed while you were editing. Reload and try again." };
    }

    const snapshot = (pickup: string | null, areas: { name: string; feeCents: number }[]) => ({
      pickupAddress: pickup,
      areas: areas.map(({ name, feeCents }) => ({ name, feeCents })),
    });
    const was = snapshot(settings?.pickupAddress ?? null, before);
    const now = snapshot(input.value.pickupAddress, input.value.areas);
    if (JSON.stringify(was) === JSON.stringify(now)) return { ok: true, changed: false };

    await tx.shopSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, pickupAddress: input.value.pickupAddress },
      update: { pickupAddress: input.value.pickupAddress },
    });

    const kept = new Set(input.value.areas.flatMap((area) => (area.id ? [area.id] : [])));
    await tx.deliveryArea.deleteMany({
      where: { id: { in: [...known].filter((id) => !kept.has(id)) } },
    });
    // Parked under temporary names first, so swapping two names cannot trip
    // the unique index halfway through.
    for (const id of kept) {
      await tx.deliveryArea.update({ where: { id }, data: { name: `~renaming ${id}` } });
    }
    for (const [position, area] of input.value.areas.entries()) {
      const data = { name: area.name, feeCents: area.feeCents, position };
      if (area.id) await tx.deliveryArea.update({ where: { id: area.id }, data });
      else await tx.deliveryArea.create({ data });
    }

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "settings.update-delivery",
      entityType: "ShopSettings",
      entityId: SINGLETON,
      before: was,
      after: now,
    });

    return { ok: true, changed: true };
  });
}

function readFee(raw: string): number | null {
  try {
    return parsePriceToCents(raw);
  } catch (error) {
    if (error instanceof InvalidPriceError) return null;
    throw error;
  }
}

type Snapshot = { pickupAddress?: unknown; areas?: unknown };

/**
 * Pure: what changed, in words, for the settings page's history.
 * "Westlands: KSh 250 → KSh 300", "Added Rongai (KSh 400)", "Pickup point: (none) → HH Towers".
 */
export function describeDeliveryChanges(before: Snapshot | null, after: Snapshot | null): string[] {
  const areasOf = (snapshot: Snapshot | null) =>
    new Map(
      (Array.isArray(snapshot?.areas) ? snapshot.areas : []).map(
        (area: { name: string; feeCents: number }) => [area.name, area.feeCents] as const,
      ),
    );
  const fee = (cents: number) => (cents === 0 ? "free" : formatPrice(cents));
  const [was, now] = [areasOf(before), areasOf(after)];
  const lines: string[] = [];

  const pickup = (snapshot: Snapshot | null) =>
    typeof snapshot?.pickupAddress === "string" ? snapshot.pickupAddress : "(none)";
  if (pickup(before) !== pickup(after)) {
    lines.push(`Pickup point: ${pickup(before)} → ${pickup(after)}`);
  }
  for (const [name, cents] of now) {
    const old = was.get(name);
    if (old === undefined) lines.push(`Added ${name} (${fee(cents)})`);
    else if (old !== cents) lines.push(`${name}: ${fee(old)} → ${fee(cents)}`);
  }
  for (const name of was.keys()) {
    if (!now.has(name)) lines.push(`Removed ${name}`);
  }

  return lines;
}
