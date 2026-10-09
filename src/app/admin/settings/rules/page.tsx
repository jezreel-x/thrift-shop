import { SettingsHeader } from "@/components/admin/settings-header";
import { ShopRulesForm } from "@/components/admin/shop-rules-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { getShopRulesFormValue } from "@/lib/admin/shop-rules";

export const generateMetadata = staffTitle("Shop rules", Permission.SETTINGS_EDIT);

export default async function ShopRulesPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings/rules");

  const rules = await getShopRulesFormValue();

  return (
    <main className="mx-auto w-full max-w-5xl">
      <SettingsHeader title="Shop rules" changes="rules">
        What every buyer can do in the shop.
      </SettingsHeader>

      <div className="mt-8">
        <ShopRulesForm initial={rules.maxPerItem} />
      </div>
    </main>
  );
}
