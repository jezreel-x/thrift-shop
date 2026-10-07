-- Products created in the admin have variants and a category row; they have no
-- single size and no old enum category. Nothing reads either column any more,
-- so they become optional now and are dropped in the contract migration.
-- Dropping NOT NULL never fails and needs no backfill.

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "size" DROP NOT NULL,
ALTER COLUMN "category" DROP NOT NULL;
