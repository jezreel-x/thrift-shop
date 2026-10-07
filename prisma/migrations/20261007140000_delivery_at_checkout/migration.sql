-- Delivery at checkout: pickup or delivery to an area, with the fee the owner
-- sets for that area. Expand only: every new column is optional or has a
-- default, so orders and accounts from before simply have no delivery details.

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryArea" TEXT,
ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryPhone" TEXT,
ADD COLUMN     "fulfilment" "Fulfilment",
ADD COLUMN     "pickupAddress" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "pickupAddress" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryAreaId" TEXT,
ADD COLUMN     "deliveryPhone" TEXT,
ADD COLUMN     "fulfilment" "Fulfilment";

-- CreateTable
CREATE TABLE "DeliveryArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryArea_name_key" ON "DeliveryArea"("name");

-- CreateIndex
CREATE INDEX "DeliveryArea_position_idx" ON "DeliveryArea"("position");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_deliveryAreaId_fkey" FOREIGN KEY ("deliveryAreaId") REFERENCES "DeliveryArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A fee is never negative: a typo must not pay the buyer to order.

ALTER TABLE "DeliveryArea" ADD CONSTRAINT "DeliveryArea_feeCents_check" CHECK ("feeCents" >= 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryFeeCents_check" CHECK ("deliveryFeeCents" >= 0);
