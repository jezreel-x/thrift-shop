-- Categories as data, expand step. See docs/product-variants.md.
--
-- Adds ProductCategory and Product.categoryId, and makes condition and gender
-- optional (shown only where a category uses them). The Category enum and
-- Product.category stay until the contract migration.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" TEXT,
ALTER COLUMN "condition" DROP NOT NULL,
ALTER COLUMN "gender" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "option1Name" TEXT,
    "option2Name" TEXT,
    "option2Values" TEXT[],
    "showCondition" BOOLEAN NOT NULL DEFAULT true,
    "showFit" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_slug_key" ON "ProductCategory"("slug");

-- CreateIndex
CREATE INDEX "ProductCategory_position_idx" ON "ProductCategory"("position");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------
-- Backfill: one row per value of the old enum, in the order the shop listed
-- them, so the catalogue behaves exactly as before: option 2 is "Size" in
-- letter sizes, no option 1, Condition and Fit shown.

INSERT INTO "ProductCategory" ("id", "slug", "name", "position", "option1Name", "option2Name", "option2Values", "showCondition", "showFit", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'hoodies', 'Hoodies', 0, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sweatshirts', 'Sweatshirts', 1, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 't-shirts', 'T-shirts', 2, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'flannels', 'Flannels', 3, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sweatpants', 'Sweatpants', 4, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'wide-leg-sweatpants', 'Wide-leg sweatpants', 5, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'side-pocket-pants', 'Side-pocket pants', 6, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'underwear', 'Underwear', 7, NULL, 'Size', ARRAY['XS','S','M','L','XL','XXL'], true, true, CURRENT_TIMESTAMP);

-- Every product to the row for its own enum value: HOODIES -> hoodies,
-- WIDE_LEG_SWEATPANTS -> wide-leg-sweatpants.
UPDATE "Product" p
   SET "categoryId" = c."id"
  FROM "ProductCategory" c
 WHERE c."slug" = lower(replace(p."category"::text, '_', '-'));
