# Seed photography

Drop the shop's product photos here, then run:

```bash
npm run seed:upload   # resize, hash, upload to blob storage, write the manifest
npm run seed          # create the products from that manifest
```

The images themselves are **not committed** — see `.gitignore`. What gets
committed is `prisma/seed-manifest.json`, which records the uploaded URLs,
dimensions and checksums, so anyone who clones the repo can seed a working
catalogue without needing the originals.

## Layout

One folder per garment, inside a folder named for its category. Only a person
can say which photographs show the same jacket, so the folder structure is how
you say it.

```
seed-images/
  hoodies/
    grey-nike-hoodie/
      1.jpg
    black-champion-hoodie/
      1.jpg
      2.jpg
      3.jpg
  t-shirts/
    faded-band-tee/
      1.jpg
  ...
```

- **Category folder** must be one of: `hoodies`, `sweatshirts`, `t-shirts`,
  `flannels`, `sweatpants`, `wide-leg-sweatpants`, `side-pocket-pants`,
  `underwear`.
- **Garment folder** names the item, and becomes its URL slug. Use words:
  `grey-nike-hoodie`, not `IMG_4471`.
- **File names** set the display order. `1.jpg` is the card thumbnail; the rest
  follow in numeric order.

Accepted formats: JPEG, PNG, WebP, HEIC.

## How many

Roughly **4–5 different garments per category**, one photo each — about 40
items in total. That is enough that filtering by a category returns a plausible
grid rather than one lonely item, and enough to fill more than one page.

Then give **two or three of those garments** a second and third angle, so the
detail page has a real gallery.

## Getting them from WhatsApp

Ask for them as **documents**, not photos. WhatsApp recompresses anything sent
as a photo to around 800px and strips quality; sent as a document the original
file arrives intact. The difference is very visible on a product page.

## After uploading

`prisma/seed-manifest.json` will contain an entry per garment with its images
already filled in, and the details left at placeholder values:

```jsonc
{
  "slug": "grey-nike-hoodie",
  "category": "HOODIES",
  "title": "Grey Nike hoodie",
  "priceCents": 0, //  <- fill these in
  "size": "M",
  "condition": "GOOD",
  "gender": "UNISEX",
  "images": [{ "url": "...", "width": 1333, "height": 2000, ... }]
}
```

Edit those, then run `npm run seed`. Re-running the upload preserves anything
you have already filled in and only adds what is new.
