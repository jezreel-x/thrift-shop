import { DeliverySettingsForm } from "@/components/admin/delivery-settings-form";
import { PaymentSettingsForm } from "@/components/admin/payment-settings-form";
import { RemovePaymentDetails } from "@/components/admin/remove-payment-details";
import { WhatsAppSettingsForm } from "@/components/admin/whatsapp-settings-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { getDeliverySettings } from "@/lib/admin/delivery-settings";
import { staffTitle } from "@/lib/admin/metadata";
import {
  getPaymentSettingsFormValues,
  getWhatsAppFormValue,
  listPaymentSettingsHistory,
} from "@/lib/admin/payment-settings";
import { formatDateTime } from "@/lib/dates";
import { centsToInput } from "@/lib/admin/products";
import { PAYMENT_INSTRUCTIONS, PAYMENT_NUMBER_LABELS } from "@/lib/shop/settings";

export const generateMetadata = staffTitle("Settings", Permission.SETTINGS_EDIT);

export default async function AdminSettingsPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings");

  const [initial, history, whatsapp, delivery] = await Promise.all([
    getPaymentSettingsFormValues(),
    listPaymentSettingsHistory(),
    getWhatsAppFormValue(),
    getDeliverySettings(),
  ]);
  const hasDetails = Boolean(initial.method || initial.number || initial.name);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section aria-labelledby="payment" className="mt-8">
        <h2 id="payment" className="text-lg font-semibold">
          Payment details
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Where buyers send money at checkout. Every change is recorded below with who made it,
          because changing this changes where the shop gets paid.
        </p>

        <div className="mt-6">
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
      </section>

      {hasDetails && <RemovePaymentDetails />}

      <section aria-labelledby="whatsapp" className="mt-12">
        <h2 id="whatsapp" className="text-lg font-semibold">
          WhatsApp
        </h2>
        <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
          Buyers can send their order to this number from a product page or their cart, already
          written out. The shop confirms availability in the chat.
        </p>
        <WhatsAppSettingsForm initial={whatsapp} />
      </section>

      <section aria-labelledby="delivery" className="mt-12">
        <h2 id="delivery" className="text-lg font-semibold">
          Pickup and delivery
        </h2>
        <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
          What checkout offers. Set neither and buyers aren&apos;t asked; you arrange it with them
          as before.
        </p>
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
      </section>

      <section aria-labelledby="changes" className="mt-12">
        <h2 id="changes" className="text-[11px] font-medium tracking-wider text-muted uppercase">
          Recent changes
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No changes yet.</p>
        ) : (
          <ol className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {history.map((change) => (
              <li key={change.id} className="p-4 text-sm">
                <p>
                  <span className="font-medium">{change.actor}</span>{" "}
                  <span className="text-muted">· {formatDateTime(change.createdAt)}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {change.changes.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
