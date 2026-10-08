-- The contract step of moving from one-of-one items to variants with stock
-- (docs/product-variants.md): expand, backfill, switch the code, then drop
-- what nothing reads any more.
--
--   Product.size, .category      superseded by ProductVariant.option2 and categoryId
--   Product.status               availability is worked out from stock and holds
--   Product.reservedBy/Until     superseded by StockHold
--   ProductStatusHistory         superseded by StockMovement (the stock ledger)
--   enums Category, ProductStatus
--
-- And the links the backfill filled become required: every product has a
-- category row, every cart and order line a variant. Checked on production
-- before this was written: no row is missing any of them.

-- DropForeignKey
ALTER TABLE "ProductStatusHistory" DROP CONSTRAINT "ProductStatusHistory_productId_fkey";

-- DropIndex
DROP INDEX "Product_deletedAt_idx";

-- DropIndex
DROP INDEX "Product_status_category_idx";

-- DropIndex
DROP INDEX "Product_status_createdAt_idx";

-- DropIndex
DROP INDEX "Product_status_gender_idx";

-- DropIndex
DROP INDEX "Product_status_priceCents_idx";

-- DropIndex
DROP INDEX "Product_status_reservedUntil_idx";

-- DropIndex
DROP INDEX "Product_status_size_idx";

-- AlterTable
ALTER TABLE "CartItem" ALTER COLUMN "variantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "variantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "category",
DROP COLUMN "reservedBy",
DROP COLUMN "reservedUntil",
DROP COLUMN "size",
DROP COLUMN "status",
ALTER COLUMN "categoryId" SET NOT NULL;

-- DropTable
DROP TABLE "ProductStatusHistory";

-- DropEnum
DROP TYPE "Category";

-- DropEnum
DROP TYPE "ProductStatus";

-- CreateIndex
CREATE INDEX "Product_deletedAt_createdAt_idx" ON "Product"("deletedAt", "createdAt");

