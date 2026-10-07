-- Clothing comes in colours. The categories were created from one-of-one
-- thrift stock, where each item is a single colour and option 1 was left off;
-- the product form offers colours only where the category names option 1.
-- The shop already shows a colour picker only for products with swatches, so
-- one-of-one items look exactly as before.
UPDATE "ProductCategory"
   SET "option1Name" = 'Colour', "updatedAt" = now()
 WHERE "option1Name" IS NULL
   AND "slug" IN ('hoodies', 'sweatshirts', 't-shirts', 'flannels', 'sweatpants',
                  'wide-leg-sweatpants', 'side-pocket-pants', 'underwear');
