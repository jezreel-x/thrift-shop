-- The per-item limit becomes the owner's setting instead of a fixed 5. The
-- existing settings row takes the default, 5, so nothing changes until the
-- owner changes it. Null means no limit.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "maxPerItem" INTEGER DEFAULT 5;


-- At least one; and a ceiling that catches a slipped digit, not a real policy.

ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_maxPerItem_check" CHECK ("maxPerItem" BETWEEN 1 AND 999);
