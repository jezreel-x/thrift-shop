import { DeliverySettingsForm } from "@/components/admin/delivery-settings-form";
import { SettingsHeader } from "@/components/admin/settings-header";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { getDeliverySettings } from "@/lib/admin/delivery-settings";
import { staffTitle } from "@/lib/admin/metadata";
import { centsToInput } from "@/lib/admin/products";

export const generateMetadata = staffTitle("Pickup & delivery", Permission.SETTINGS_EDIT);

export default async function DeliverySettingsPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings/delivery");

  const delivery = await getDeliverySettings();

  return (
    <main className="mx-auto w-full max-w-5xl">
      <SettingsHeader title="Pickup & delivery" changes="delivery">
        What checkout offers. Set neither and buyers aren&apos;t asked; you arrange it with them as
        before.
      </SettingsHeader>

      <div className="mt-8">
        <DeliverySettingsForm
          initial={{
            pickupAddress: delivery.pickupAddress ?? "",
            areas: delivery.areas.map((area) => ({
              id: area.id!,
              name: area.name,
              fee: centsToInput(area.feeCents),
            })),
          }}
        />
      </div>
    </main>
  );
}
