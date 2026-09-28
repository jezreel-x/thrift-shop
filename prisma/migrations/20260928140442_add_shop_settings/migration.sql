-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TILL', 'PAYBILL', 'POCHI');

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "payment" "PaymentMethod",
    "paymentName" TEXT,
    "tillNumber" TEXT,
    "accountNumber" TEXT,
    "paymentNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);
