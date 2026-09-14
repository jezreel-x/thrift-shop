-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MENS', 'WOMENS', 'UNISEX');

-- AlterEnum
-- The previous categories were generic shelves (TOPS, BOTTOMS, DRESSES, ...).
-- They are replaced wholesale by the shop's actual range. Any row still holding
-- an old value would fail the cast below, which is the correct outcome: it means
-- stock exists that nobody has reclassified, and silently mapping it would be a
-- guess recorded as fact.
BEGIN;
CREATE TYPE "Category_new" AS ENUM ('HOODIES', 'SWEATSHIRTS', 'T_SHIRTS', 'FLANNELS', 'SWEATPANTS', 'WIDE_LEG_SWEATPANTS', 'SIDE_POCKET_PANTS', 'UNDERWEAR');
ALTER TABLE "Product" ALTER COLUMN "category" TYPE "Category_new" USING ("category"::text::"Category_new");
ALTER TYPE "Category" RENAME TO "Category_old";
ALTER TYPE "Category_new" RENAME TO "Category";
DROP TYPE "public"."Category_old";
COMMIT;

-- AlterTable
-- Added with a default and then stripped of it, in two steps.
--
-- A bare `ADD COLUMN ... NOT NULL` succeeds only while the table is empty: there
-- is no value for the rows already there. Prisma generated exactly that, and it
-- passed against an empty database and failed against one with rows in it — the
-- same failure it would produce on a production deploy.
--
-- The default backfills existing rows; dropping it immediately afterwards means
-- every future insert must still state the gender explicitly rather than
-- silently inheriting UNISEX.
ALTER TABLE "Product" ADD COLUMN "gender" "Gender" NOT NULL DEFAULT 'UNISEX';
ALTER TABLE "Product" ALTER COLUMN "gender" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Product_status_gender_idx" ON "Product"("status", "gender");
