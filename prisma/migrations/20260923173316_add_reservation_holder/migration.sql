-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reservedBy" TEXT;

-- CreateIndex
CREATE INDEX "Product_status_reservedUntil_idx" ON "Product"("status", "reservedUntil");
