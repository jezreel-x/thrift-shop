-- CreateEnum
CREATE TYPE "SettledVia" AS ENUM ('CALLBACK', 'BUYER_PAGE', 'HOUSEKEEPING', 'STAFF_CHECK', 'STAFF');

-- AlterEnum
ALTER TYPE "PaymentChannel" ADD VALUE 'MPESA_STK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "callback" JSONB,
ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "checkoutRequestId" TEXT,
ADD COLUMN     "merchantRequestId" TEXT,
ADD COLUMN     "resultCode" INTEGER,
ADD COLUMN     "resultDesc" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledVia" "SettledVia";

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutRequestId_key" ON "Payment"("checkoutRequestId");

-- Backfill (written by hand: Prisma diffs schemas, not data).
-- Every payment decided so far was a typed code that staff confirmed or
-- rejected by hand, so how it settled is known: by staff, when they decided.
-- Uses only values that existed before this migration, plus the new
-- "SettledVia" type, which (unlike an added enum value) is usable at once.
UPDATE "Payment" p
   SET "settledVia" = 'STAFF',
       "settledAt"  = COALESCE(p."receivedAt", o."reviewedAt")
  FROM "Order" o
 WHERE o."id" = p."orderId"
   AND p."channel" = 'MPESA_MANUAL'
   AND p."status" IN ('RECEIVED', 'REFUNDED', 'REJECTED');
