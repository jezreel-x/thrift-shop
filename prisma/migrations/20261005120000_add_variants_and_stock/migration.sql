-- Variants and stock, expand step. See docs/product-variants.md.
--
-- Adds variants, swatches, holds and the stock ledger, and points cart and order
-- lines at variants. Nothing is dropped: Product.size, status, reservedBy and
-- reservedUntil stay until the contract migration, after the code that stopped
-- reading them is live.

-- DropIndex
DROP INDEX "CartItem_cartId_productId_key";

-- DropIndex
DROP INDEX "OrderItem_orderId_productId_key";

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "swatch" TEXT,
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "swatchId" TEXT;

-- CreateTable
CREATE TABLE "ProductSwatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSwatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "swatchId" TEXT,
    "option2" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockHold" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "change" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSwatch_productId_position_idx" ON "ProductSwatch"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSwatch_productId_name_key" ON "ProductSwatch"("productId", "name");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
-- NULLS NOT DISTINCT, edited by hand (Prisma cannot express it): a product with
-- no options has swatchId and option2 both null, and without this Postgres would
-- treat every such row as distinct and allow duplicates.
CREATE UNIQUE INDEX "ProductVariant_productId_swatchId_option2_key" ON "ProductVariant"("productId", "swatchId", "option2") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "StockHold_variantId_expiresAt_idx" ON "StockHold"("variantId", "expiresAt");

-- CreateIndex
CREATE INDEX "StockHold_expiresAt_idx" ON "StockHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockHold_variantId_holder_key" ON "StockHold"("variantId", "holder");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_variantId_key" ON "OrderItem"("orderId", "variantId");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_swatchId_fkey" FOREIGN KEY ("swatchId") REFERENCES "ProductSwatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSwatch" ADD CONSTRAINT "ProductSwatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_swatchId_fkey" FOREIGN KEY ("swatchId") REFERENCES "ProductSwatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHold" ADD CONSTRAINT "StockHold_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ------------------------------------------------------------------------------
-- Invariants the database enforces, whatever the code does.

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_not_negative" CHECK ("stock" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_not_negative" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
ALTER TABLE "StockHold" ADD CONSTRAINT "StockHold_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 5);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" >= 1);

-- ------------------------------------------------------------------------------
-- Backfill: today's catalogue, carried exactly.

-- One variant per product: its size, no swatch, one unit unless it has sold.
INSERT INTO "ProductVariant" ("id", "productId", "swatchId", "option2", "stock", "priceCents", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", NULL, p."size",
       CASE WHEN p."status" = 'SOLD' THEN 0 ELSE 1 END,
       NULL, p."createdAt", CURRENT_TIMESTAMP
  FROM "Product" p;

-- Live reservations become holds. A lapsed one already belonged to nobody, so
-- it is not carried over.
INSERT INTO "StockHold" ("id", "variantId", "holder", "quantity", "expiresAt", "updatedAt")
SELECT gen_random_uuid()::text, v."id", p."reservedBy", 1, p."reservedUntil", CURRENT_TIMESTAMP
  FROM "Product" p
  JOIN "ProductVariant" v ON v."productId" = p."id"
 WHERE p."status" = 'RESERVED'
   AND p."reservedBy" IS NOT NULL
   AND p."reservedUntil" > CURRENT_TIMESTAMP;

-- Every cart and order line points at its product's only variant.
UPDATE "CartItem" c SET "variantId" = v."id"
  FROM "ProductVariant" v WHERE v."productId" = c."productId";

UPDATE "OrderItem" o SET "variantId" = v."id"
  FROM "ProductVariant" v WHERE v."productId" = o."productId";

-- The ledger opens with what is on the shelf.
INSERT INTO "StockMovement" ("id", "variantId", "change", "reason")
SELECT gen_random_uuid()::text, v."id", v."stock", 'opening stock'
  FROM "ProductVariant" v
 WHERE v."stock" > 0;
