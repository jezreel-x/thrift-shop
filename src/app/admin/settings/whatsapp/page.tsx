import { SettingsHeader } from "@/components/admin/settings-header";
import { WhatsAppSettingsForm } from "@/components/admin/whatsapp-settings-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { getWhatsAppFormValue } from "@/lib/admin/payment-settings";

export const generateMetadata = staffTitle("WhatsApp", Permission.SETTINGS_EDIT);

export default async function WhatsAppSettingsPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings/whatsapp");

  const whatsapp = await getWhatsAppFormValue();

  return (
    <main className="mx-auto w-full max-w-5xl">
      <SettingsHeader title="WhatsApp" changes="whatsapp">
        Buyers can send their order to this number from a product page or their cart, already
        written out. The shop confirms availability in the chat.
      </SettingsHeader>

      <div className="mt-8">
        <WhatsAppSettingsForm initial={whatsapp} />
      </div>
    </main>
  );
}
