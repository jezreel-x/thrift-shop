-- Payments foundation (docs/payments.md, P1): two order states for money that
-- arrived after the items had gone, and a Payment record per payment. Expand
-- only. Adding enum values in one migration needs PostgreSQL 12 or later
-- (both local and Neon run 18); nothing below uses the new values.

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MPESA_MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CLAIMED', 'RECEIVED', 'REJECTED', 'REFUNDED');

-- AlterEnum


ALTER TYPE "OrderStatus" ADD VALUE 'NEEDS_REFUND';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receipt" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "refundNote" TEXT,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receipt_key" ON "Payment"("receipt");

-- CreateIndex
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An amount is never zero or negative.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountCents_check" CHECK ("amountCents" > 0);

-- Backfill: every order that already has a code gets the payment it describes,
-- so the payment history starts complete. A confirmed order's payment was
-- received when it was reviewed.
INSERT INTO "Payment" ("id", "orderId", "channel", "status", "amountCents", "receipt", "phone", "createdAt", "receivedAt")
SELECT gen_random_uuid()::text,
       o."id",
       'MPESA_MANUAL',
       CASE o."status"
         WHEN 'CONFIRMED' THEN 'RECEIVED'::"PaymentStatus"
         WHEN 'REJECTED' THEN 'REJECTED'::"PaymentStatus"
         ELSE 'CLAIMED'::"PaymentStatus"
       END,
       o."totalCents",
       o."mpesaCode",
       o."buyerPhone",
       COALESCE(o."claimedAt", o."createdAt"),
       CASE WHEN o."status" = 'CONFIRMED' THEN o."reviewedAt" END
  FROM "Order" o
 WHERE o."mpesaCode" IS NOT NULL;
