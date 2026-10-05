-- The shop's WhatsApp number, for "Order on WhatsApp". Nullable, no backfill:
-- until the owner sets it, the button is simply not shown.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "whatsappNumber" TEXT;

