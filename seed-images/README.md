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
- **File names** are free-form. Photos are sorted by filename, and the first one
  becomes the card thumbnail.

Accepted formats: JPEG, PNG, WebP, HEIC.

### Which category

| Folder                | Goes in                                                                                        | Doesn't                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `hoodies`             | Anything with a hood: pullovers, zip-ups, hooded sweatshirts, sherpa-lined, cropped, oversized | Hooded _jackets_ — nylon shells, denim         |
| `sweatshirts`         | Fleece-backed tops with **no** hood: crewnecks, quarter-zips, mock necks                       | Anything hooded; knitted jumpers and cardigans |
| `t-shirts`            | Jersey knit: plain, graphic and band tees, long-sleeve tees, tanks, polos                      | Button-front shirts                            |
| `flannels`            | Button-front brushed-cotton shirts — plaid, check, plain                                       | Overshirts heavy enough to be a jacket         |
| `sweatpants`          | Elasticated waist, tapered or straight: joggers, cuffed sweats, track pants                    | Wide legs; thigh pockets                       |
| `wide-leg-sweatpants` | Same fabric, leg falling straight and wide from the knee: baggy, flared, puddle pants          | Tapered or cuffed legs                         |
| `side-pocket-pants`   | Pockets on the outside of the thigh: cargos, utility and combat trousers, cargo sweatpants     | Only ordinary hip and back pockets             |
| `underwear`           | Briefs, boxers, bralettes, sets                                                                | —                                              |

When two categories fit, the more specific one wins:

- **A hooded sweatshirt is a hoodie.** The hood is what someone shops for, so it
  beats the fabric. `sweatshirts` means crewnecks in practice.
- **Cargo sweatpants are `side-pocket-pants`.** Fabric says sweatpants, pockets
  say side-pocket — and the pockets are why that category exists separately.
- **Wide-leg is about silhouette, not fabric.** If you hesitate, it's regular.

The rule behind all three: file it where a buyer would go looking, not where it
technically belongs.

Jackets, plain button-up shirts, knitwear, shorts, dresses and skirts have no
folder, because the shop does not stock them. Hesitating over a photo because
nothing fits is the signal that a category is missing — that is a schema change,
not a judgement call, so raise it rather than forcing the item somewhere.

### Getting the order right

Sorting is numeric-aware, so `9.jpg` comes before `10.jpg` rather than after it,
and files straight off a phone or out of WhatsApp already sort into the order
they were taken:

```
IMG_4471.jpg  IMG_4472.jpg  IMG_4480.jpg          ← capture order, fine as-is
1.jpg  2.jpg  10.jpg                              ← fine
01-front.jpg  02-back.jpg  03-detail.jpg          ← fine
```

The one thing that catches people out is naming photos after what they show:

```
front.jpg  back.jpg  detail.jpg                   ← sorts to back, detail, front
```

Alphabetical order has nothing to do with which photo should lead, so the back
of the garment ends up as the thumbnail. Put a number in front if you want
words: `01-front.jpg`.

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
