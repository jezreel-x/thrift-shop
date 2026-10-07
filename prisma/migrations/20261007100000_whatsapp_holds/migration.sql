-- Holds placed by staff for a WhatsApp buyer: who the hold is for, and who
-- placed it. Both optional; a buyer's own checkout hold leaves them empty.

-- AlterTable
ALTER TABLE "StockHold" ADD COLUMN     "note" TEXT,
ADD COLUMN     "placedById" TEXT;
