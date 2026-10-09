-- The cart's quantity was checked against a fixed 1 to 5 since the variants
-- work. The limit is now the owner's setting (ShopSettings.maxPerItem, or none),
-- enforced where items are added; the database keeps only what is always
-- true, the same as for holds and order lines: at least one.
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_quantity_range";
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" >= 1);
