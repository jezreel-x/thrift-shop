import { PaymentSettingsForm } from "@/components/admin/payment-settings-form";
import { RemovePaymentDetails } from "@/components/admin/remove-payment-details";
import { SettingsHeader } from "@/components/admin/settings-header";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { getPaymentSettingsFormValues } from "@/lib/admin/payment-settings";
import { PAYMENT_INSTRUCTIONS, PAYMENT_NUMBER_LABELS } from "@/lib/shop/settings";

export const generateMetadata = staffTitle("Payment details", Permission.SETTINGS_EDIT);

export default async function PaymentSettingsPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings/payment");

  const initial = await getPaymentSettingsFormValues();
  const hasDetails = Boolean(initial.method || initial.number || initial.name);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <SettingsHeader title="Payment details" changes="payment">
        Where buyers send money at checkout. Every change is recorded with who made it, because
        changing this changes where the shop gets paid.
      </SettingsHeader>

      <div className="mt-8">
        {/* Labels are passed in so the client form never imports server code. */}
        <PaymentSettingsForm
          // Remount when the details are removed or first set, so the form
          // shows what is saved rather than what was last typed.
          key={hasDetails ? "set" : "empty"}
          initial={initial}
          instructions={PAYMENT_INSTRUCTIONS}
          numberLabels={PAYMENT_NUMBER_LABELS}
        />
      </div>

      {hasDetails && <RemovePaymentDetails />}
    </main>
  );
}
